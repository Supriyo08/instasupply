import type { CoreStatus } from '../auth/session';
import type { ApiClient } from '../client';
import { toApiError, type ApiError } from '../errors';
import type { LiveClient, LiveEvent } from '../live/live-client';
import type { Clock, Lifecycle, LifecycleEvent } from '../platform';

import {
  REFETCH,
  type QueryCache,
  type QueryDescriptor,
  type QueryKey,
  type QueryObservation,
  type QueryResult,
} from './types';

export const DEFAULTS = {
  pollMs: 15_000,
  staleMs: 30_000,
  minRefetchMs: 250,
  gcMs: 300_000,
} as const;

/** First-fetch failures that may heal are retried after 2, 5, 15, then every 30 s while observed (§1.10). */
export const ERROR_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];
/** Short-lived URLs refetch this long before they expire. */
const EXPIRY_MARGIN_MS = 60_000;

export interface QueryCacheDeps {
  client: () => ApiClient;
  clock: Clock;
  live: LiveClient;
  lifecycle: Lifecycle;
  session: { status(): CoreStatus; subscribe(listener: () => void): () => void };
  serverNow(): number;
}

type Gate = 'disabled' | 'blocked' | 'wait' | 'ok';

interface Observer {
  live: boolean;
  onChange: () => void;
}

interface Patch {
  apply: (current: unknown) => unknown;
}

interface Entry {
  hash: string;
  key: QueryKey;
  descriptor: QueryDescriptor<unknown> | null;
  hasData: boolean;
  serverData: unknown;
  updatedAt: number | null;
  error: ApiError | null;
  stale: boolean;
  fetching: { controller: AbortController; token: object } | null;
  trailing: boolean;
  idleWaiters: (() => void)[];
  observers: Set<Observer>;
  patches: Patch[];
  topicOffs: (() => void)[];
  topicsSignature: string;
  pollTimer: unknown;
  retryTimer: unknown;
  retryIndex: number;
  gcTimer: unknown;
  eventTimer: unknown;
  expiryTimer: unknown;
  lastEventFetchAt: number;
  version: number;
  memo: { stamp: string; result: QueryResult<unknown> } | null;
  retry: () => void;
}

export function hashKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export function keyStartsWith(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((part, i) => key[i] === part);
}

function isListEmpty(descriptor: QueryDescriptor<unknown> | null): boolean {
  return Array.isArray(descriptor?.empty);
}

export function keepsPreviousData(descriptor: QueryDescriptor<unknown>): boolean {
  return descriptor.keepPreviousData ?? Array.isArray(descriptor.empty);
}

export class QueryCacheImpl implements QueryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly deps: QueryCacheDeps) {
    const { live, lifecycle, session } = deps;
    this.disposers.push(
      live.onState(() => this.forEachObserved((entry) => this.updateTimers(entry))),
      live.onDenied(() => this.forEachObserved((entry) => this.updateTimers(entry))),
      live.onResync(() =>
        this.forEachObserved((entry) => {
          if (this.liveCount(entry) > 0) this.runFetch(entry);
        }),
      ),
      lifecycle.subscribe((event) => this.onLifecycle(event)),
      session.subscribe(() => this.onSession()),
    );
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const entry of this.entries.values()) this.teardown(entry);
    this.entries.clear();
  }

  // ---------- public API ----------

  observe<T>(query: QueryDescriptor<T>, mode: { live: boolean }, onChange: () => void): QueryObservation<T> {
    if (query.enabled === false) {
      const result = disabledResult(query.empty);
      return { getResult: () => result, unsubscribe: () => undefined };
    }
    const entry = this.entryFor(query);
    this.clearTimer(entry, 'gcTimer');
    const observer: Observer = { live: mode.live, onChange };
    entry.observers.add(observer);
    this.syncTopics(entry);
    if (this.gate(entry) === 'ok' && !entry.fetching && (!entry.hasData || this.isStale(entry))) {
      this.runFetch(entry);
    }
    this.updateTimers(entry);
    let active = true;
    return {
      getResult: () => this.resultFor(entry) as QueryResult<T>,
      unsubscribe: () => {
        if (!active) return;
        active = false;
        entry.observers.delete(observer);
        this.onObserverLeft(entry);
      },
    };
  }

  /** The result a new observer would see right now, without observing (render before subscribe). */
  peek<T>(query: QueryDescriptor<T>): QueryResult<T> {
    if (query.enabled === false) return disabledResult(query.empty);
    const entry = this.entries.get(hashKey(query.key));
    if (entry) {
      entry.descriptor = query as QueryDescriptor<unknown>;
      return this.resultFor(entry) as QueryResult<T>;
    }
    const gate = this.gateFor(query as QueryDescriptor<unknown>);
    return {
      data: query.empty,
      loading: gate === 'ok' || gate === 'wait',
      error: null,
      retry: noop,
      refreshing: false,
      updatedAt: null,
    };
  }

  getData<T>(key: QueryKey): T | undefined {
    const entry = this.entries.get(hashKey(key));
    if (!entry || !entry.hasData) return undefined;
    return this.visible(entry) as T;
  }

  setData<T>(key: QueryKey, update: T | ((current: T | undefined) => T | undefined)): void {
    const entry = this.entries.get(hashKey(key)) ?? this.createEntry(key, null);
    const current = entry.hasData ? (entry.serverData as T) : undefined;
    const next =
      typeof update === 'function' ? (update as (current: T | undefined) => T | undefined)(current) : update;
    if (next === undefined) return;
    entry.serverData = next;
    entry.hasData = true;
    entry.error = null;
    entry.updatedAt = this.deps.clock.now();
    this.bump(entry);
    if (entry.observers.size === 0) this.scheduleGc(entry);
  }

  invalidate(prefix: QueryKey): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!keyStartsWith(entry.key, prefix)) continue;
      entry.stale = true;
      if (entry.observers.size > 0 && this.gate(entry) === 'ok') {
        this.runFetch(entry);
        waits.push(this.whenIdle(entry));
      }
    }
    return Promise.all(waits).then(() => undefined);
  }

  invalidateAll(): Promise<void> {
    return this.invalidate([]);
  }

  patch<T>(key: QueryKey, apply: (current: T) => T): () => void {
    const entry = this.entries.get(hashKey(key)) ?? this.createEntry(key, null);
    const patch: Patch = { apply: apply as (current: unknown) => unknown };
    entry.patches.push(patch);
    this.bump(entry);
    return () => {
      const index = entry.patches.indexOf(patch);
      if (index < 0) return;
      entry.patches.splice(index, 1);
      this.bump(entry);
    };
  }

  async prefetch<T>(query: QueryDescriptor<T>): Promise<T> {
    const entry = this.entryFor(query);
    if (entry.observers.size === 0) this.scheduleGc(entry);
    if (entry.hasData && !this.isStale(entry)) return this.visible(entry) as T;
    this.runFetch(entry, { force: true });
    await this.whenIdle(entry);
    if (entry.hasData) return this.visible(entry) as T;
    throw entry.error ?? toApiError(new Error('Prefetch failed'));
  }

  clearPrivate(): void {
    for (const entry of [...this.entries.values()]) {
      if ((entry.descriptor?.auth ?? 'required') === 'none') continue;
      this.abortFetch(entry);
      this.clearTimer(entry, 'retryTimer');
      this.clearTimer(entry, 'eventTimer');
      this.clearTimer(entry, 'expiryTimer');
      entry.hasData = false;
      entry.serverData = undefined;
      entry.updatedAt = null;
      entry.error = null;
      entry.patches = [];
      entry.retryIndex = 0;
      if (entry.observers.size === 0) {
        this.teardown(entry);
        this.entries.delete(entry.hash);
      } else {
        this.bump(entry);
      }
    }
  }

  /** Settles once the entry has no fetch and no trailing fetch (used by the optimistic layer). */
  whenIdleFor(key: QueryKey): Promise<void> {
    const entry = this.entries.get(hashKey(key));
    return entry ? this.whenIdle(entry) : Promise.resolve();
  }

  // ---------- entries ----------

  private entryFor<T>(query: QueryDescriptor<T>): Entry {
    const hash = hashKey(query.key);
    const existing = this.entries.get(hash);
    if (existing) {
      // The newest descriptor wins: screens rebuild descriptors on every render.
      existing.descriptor = query as QueryDescriptor<unknown>;
      return existing;
    }
    return this.createEntry(query.key, query as QueryDescriptor<unknown>);
  }

  private createEntry(key: QueryKey, descriptor: QueryDescriptor<unknown> | null): Entry {
    const entry: Entry = {
      hash: hashKey(key),
      key,
      descriptor,
      hasData: false,
      serverData: undefined,
      updatedAt: null,
      error: null,
      stale: false,
      fetching: null,
      trailing: false,
      idleWaiters: [],
      observers: new Set(),
      patches: [],
      topicOffs: [],
      topicsSignature: '',
      pollTimer: null,
      retryTimer: null,
      retryIndex: 0,
      gcTimer: null,
      eventTimer: null,
      expiryTimer: null,
      lastEventFetchAt: Number.NEGATIVE_INFINITY,
      version: 0,
      memo: null,
      retry: () => {
        entry.retryIndex = 0;
        this.clearTimer(entry, 'retryTimer');
        this.runFetch(entry, { force: true });
      },
    };
    this.entries.set(entry.hash, entry);
    return entry;
  }

  private onObserverLeft(entry: Entry): void {
    this.syncTopics(entry);
    this.updateTimers(entry);
    if (entry.observers.size > 0) return;
    this.abortFetch(entry);
    this.clearTimer(entry, 'retryTimer');
    this.clearTimer(entry, 'eventTimer');
    this.clearTimer(entry, 'expiryTimer');
    this.scheduleGc(entry);
  }

  private scheduleGc(entry: Entry): void {
    this.clearTimer(entry, 'gcTimer');
    const gcMs = entry.descriptor?.gcMs ?? DEFAULTS.gcMs;
    entry.gcTimer = this.deps.clock.setTimeout(() => {
      entry.gcTimer = null;
      if (entry.observers.size > 0) return;
      this.teardown(entry);
      this.entries.delete(entry.hash);
    }, gcMs);
  }

  private teardown(entry: Entry): void {
    this.abortFetch(entry);
    for (const off of entry.topicOffs.splice(0)) off();
    entry.topicsSignature = '';
    for (const name of ['pollTimer', 'retryTimer', 'gcTimer', 'eventTimer', 'expiryTimer'] as const) {
      this.clearTimer(entry, name);
    }
  }

  // ---------- fetching ----------

  private runFetch(entry: Entry, options?: { force?: boolean }): void {
    if (!entry.descriptor) return;
    if (entry.fetching) {
      // Something changed during this fetch: one trailing fetch, so the cache never settles on older data.
      entry.trailing = true;
      return;
    }
    if (this.gate(entry) !== 'ok') {
      this.settleIdle(entry);
      return;
    }
    if (!options?.force && entry.observers.size === 0 && entry.idleWaiters.length === 0 && entry.hasData) {
      return;
    }
    this.clearTimer(entry, 'retryTimer');
    const controller = new AbortController();
    const token = {};
    entry.fetching = { controller, token };
    this.bump(entry);
    let promise: Promise<unknown>;
    try {
      promise = entry.descriptor.fetch({ client: this.deps.client(), signal: controller.signal });
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (data) => this.onFetched(entry, token, data),
      (error: unknown) => this.onFetchFailed(entry, token, error),
    );
  }

  private onFetched(entry: Entry, token: object, data: unknown): void {
    if (entry.fetching?.token !== token) return;
    entry.fetching = null;
    entry.serverData = data;
    entry.hasData = true;
    entry.updatedAt = this.deps.clock.now();
    entry.error = null;
    entry.stale = false;
    entry.retryIndex = 0;
    this.afterFetch(entry);
  }

  private onFetchFailed(entry: Entry, token: object, raw: unknown): void {
    if (entry.fetching?.token !== token) return;
    entry.fetching = null;
    const error = toApiError(raw);
    if (!entry.hasData) {
      entry.error = error;
      if (error.retryable && entry.observers.size > 0 && !entry.trailing) this.scheduleErrorRetry(entry);
    } else if (error.status === 'permission-denied' || error.status === 'not-found') {
      // Access was lost or the document is gone: stop showing it.
      entry.hasData = false;
      entry.serverData = undefined;
      entry.updatedAt = null;
      entry.error = error;
    }
    // Any other refetch failure keeps the data on screen; the next poll, event or resync tries again.
    this.afterFetch(entry);
  }

  private afterFetch(entry: Entry): void {
    if (entry.trailing) {
      entry.trailing = false;
      this.bump(entry);
      this.runFetch(entry, { force: true });
      return;
    }
    this.settleIdle(entry);
    this.scheduleExpiry(entry);
    this.updateTimers(entry);
    this.bump(entry);
  }

  private abortFetch(entry: Entry): void {
    if (entry.fetching) {
      entry.fetching.controller.abort();
      entry.fetching = null;
    }
    entry.trailing = false;
    this.settleIdle(entry);
  }

  private whenIdle(entry: Entry): Promise<void> {
    if (!entry.fetching && !entry.trailing) return Promise.resolve();
    return new Promise((resolve) => entry.idleWaiters.push(resolve));
  }

  private settleIdle(entry: Entry): void {
    if (entry.fetching || entry.trailing) return;
    for (const resolve of entry.idleWaiters.splice(0)) resolve();
  }

  private scheduleErrorRetry(entry: Entry): void {
    this.clearTimer(entry, 'retryTimer');
    const delays = ERROR_RETRY_DELAYS_MS;
    const delay = delays[Math.min(entry.retryIndex, delays.length - 1)] ?? 30_000;
    entry.retryIndex += 1;
    entry.retryTimer = this.deps.clock.setTimeout(() => {
      entry.retryTimer = null;
      if (entry.observers.size > 0) this.runFetch(entry);
    }, delay);
  }

  private scheduleExpiry(entry: Entry): void {
    this.clearTimer(entry, 'expiryTimer');
    const expiresAt = entry.descriptor?.expiresAt;
    if (!expiresAt || !entry.hasData || entry.observers.size === 0) return;
    const at = expiresAt(entry.serverData);
    if (at === null) return;
    const wait = Math.max(0, at - EXPIRY_MARGIN_MS - this.deps.serverNow());
    entry.expiryTimer = this.deps.clock.setTimeout(() => {
      entry.expiryTimer = null;
      entry.stale = true;
      if (entry.observers.size > 0) this.runFetch(entry);
    }, wait);
  }

  // ---------- live ----------

  private liveCount(entry: Entry): number {
    let count = 0;
    for (const observer of entry.observers) if (observer.live) count += 1;
    return count;
  }

  private syncTopics(entry: Entry): void {
    const wanted =
      this.liveCount(entry) > 0 && this.gate(entry) === 'ok' ? [...(entry.descriptor?.topics ?? [])] : [];
    const signature = wanted.join('\n');
    if (signature === entry.topicsSignature) return;
    for (const off of entry.topicOffs.splice(0)) off();
    entry.topicsSignature = signature;
    for (const topic of wanted) {
      entry.topicOffs.push(this.deps.live.subscribe(topic, (event) => this.onEvent(entry, event)));
    }
  }

  private onEvent(entry: Entry, event: LiveEvent): void {
    const reduce = entry.descriptor?.reduce;
    if (reduce && entry.hasData && !entry.fetching) {
      const next = reduce(entry.serverData, event);
      if (next !== REFETCH) {
        entry.serverData = next;
        this.bump(entry);
        return;
      }
    }
    this.scheduleEventRefetch(entry);
  }

  private scheduleEventRefetch(entry: Entry): void {
    const gap = entry.descriptor?.minRefetchMs ?? DEFAULTS.minRefetchMs;
    const since = this.deps.clock.now() - entry.lastEventFetchAt;
    if (since >= gap) {
      entry.lastEventFetchAt = this.deps.clock.now();
      this.runFetch(entry);
      return;
    }
    if (entry.eventTimer !== null) return;
    entry.eventTimer = this.deps.clock.setTimeout(() => {
      entry.eventTimer = null;
      entry.lastEventFetchAt = this.deps.clock.now();
      this.runFetch(entry);
    }, gap - since);
  }

  /** Polling runs only while it replaces the socket: socket not open, or a topic of the entry denied. */
  private updateTimers(entry: Entry): void {
    const { live, lifecycle } = this.deps;
    const descriptor = entry.descriptor;
    const pollMs = descriptor?.pollMs ?? DEFAULTS.pollMs;
    const topics = descriptor?.topics ?? [];
    const shouldPoll =
      descriptor !== null &&
      this.liveCount(entry) > 0 &&
      pollMs > 0 &&
      this.gate(entry) === 'ok' &&
      lifecycle.isOnline() &&
      lifecycle.isForeground() &&
      (live.getState() !== 'open' || topics.some((topic) => live.isDenied(topic)));
    if (!shouldPoll) {
      this.clearTimer(entry, 'pollTimer');
      return;
    }
    if (entry.pollTimer !== null) return;
    entry.pollTimer = this.deps.clock.setTimeout(() => {
      entry.pollTimer = null;
      this.runFetch(entry);
      this.updateTimers(entry);
    }, pollMs);
  }

  private onLifecycle(event: LifecycleEvent): void {
    this.forEachObserved((entry) => {
      this.updateTimers(entry);
      if (
        (event === 'foreground' || event === 'online') &&
        this.isStale(entry) &&
        this.gate(entry) === 'ok'
      ) {
        this.runFetch(entry);
      }
    });
  }

  private onSession(): void {
    this.forEachObserved((entry) => {
      this.bump(entry);
      this.syncTopics(entry);
      if (this.gate(entry) === 'ok' && !entry.fetching && (!entry.hasData || this.isStale(entry))) {
        this.runFetch(entry);
      }
      this.updateTimers(entry);
    });
  }

  // ---------- results ----------

  private gate(entry: Entry): Gate {
    return entry.descriptor ? this.gateFor(entry.descriptor) : 'ok';
  }

  private gateFor(descriptor: QueryDescriptor<unknown>): Gate {
    if (descriptor.enabled === false) return 'disabled';
    if ((descriptor.auth ?? 'required') === 'none') return 'ok';
    const status = this.deps.session.status();
    if (status === 'restoring') return 'wait';
    return status === 'signed_in' ? 'ok' : 'blocked';
  }

  private isStale(entry: Entry): boolean {
    if (entry.stale || entry.updatedAt === null) return true;
    const staleMs = entry.descriptor?.staleMs ?? DEFAULTS.staleMs;
    return this.deps.clock.now() - entry.updatedAt > staleMs;
  }

  private visible(entry: Entry): unknown {
    return entry.patches.reduce((value, patch) => patch.apply(value), entry.serverData);
  }

  private resultFor(entry: Entry): QueryResult<unknown> {
    const gate = this.gate(entry);
    const stamp = `${entry.version}:${gate}`;
    if (entry.memo?.stamp === stamp) return entry.memo.result;
    const empty = entry.descriptor?.empty ?? (isListEmpty(entry.descriptor) ? [] : null);
    let result: QueryResult<unknown>;
    if (gate === 'disabled' || gate === 'blocked') {
      result = { ...disabledResult(empty), retry: entry.retry };
    } else if (gate === 'wait') {
      result = {
        data: empty,
        loading: true,
        error: null,
        retry: entry.retry,
        refreshing: false,
        updatedAt: null,
      };
    } else if (entry.hasData) {
      result = {
        data: this.visible(entry),
        loading: false,
        error: null,
        retry: entry.retry,
        refreshing: entry.fetching !== null,
        updatedAt: entry.updatedAt,
      };
    } else if (entry.fetching || entry.trailing || !entry.error) {
      result = {
        data: empty,
        loading: true,
        error: null,
        retry: entry.retry,
        refreshing: false,
        updatedAt: null,
      };
    } else {
      result = {
        data: empty,
        loading: false,
        error: entry.error,
        retry: entry.retry,
        refreshing: false,
        updatedAt: null,
      };
    }
    entry.memo = { stamp, result };
    return result;
  }

  private bump(entry: Entry): void {
    entry.version += 1;
    for (const observer of [...entry.observers]) observer.onChange();
  }

  private forEachObserved(run: (entry: Entry) => void): void {
    for (const entry of [...this.entries.values()]) if (entry.observers.size > 0) run(entry);
  }

  private clearTimer(
    entry: Entry,
    name: 'pollTimer' | 'retryTimer' | 'gcTimer' | 'eventTimer' | 'expiryTimer',
  ): void {
    const handle = entry[name];
    if (handle !== null) {
      this.deps.clock.clearTimeout(handle);
      entry[name] = null;
    }
  }
}

function noop(): void {}

function disabledResult<T>(empty: T): QueryResult<T> {
  return { data: empty, loading: false, error: null, retry: noop, refreshing: false, updatedAt: null };
}
