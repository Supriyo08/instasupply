import type { ApiClient } from '../client';
import type { Page } from '../contract';
import type { ApiError } from '../errors';
import type { LiveEvent } from '../live/live-client';

export type QueryKey = readonly (string | number | boolean | null)[];

export interface QueryContext {
  client: ApiClient;
  /** Aborted when the last observer leaves or a newer fetch replaces this one. */
  signal: AbortSignal;
}

/** Returned by `reduce` to ask for a normal refetch instead. */
export const REFETCH: unique symbol = Symbol('REFETCH');

export interface QueryDescriptor<T> {
  /** First element: the family (plural for lists, singular for one document). Only JSON scalars. */
  key: QueryKey;
  /** `data` before the first answer and while disabled: `[]` for lists, `null` for one document. */
  empty: T;
  fetch(context: QueryContext): Promise<T>;
  /** False: nothing is fetched; the result is `{ data: empty, loading: false, error: null }`. */
  enabled?: boolean;
  /** 'required' (default): fetched only while signed in and dropped when the account changes. 'none': public data. */
  auth?: 'required' | 'none';
  /** Live topics. An event on any of them refetches the query, unless `reduce` handles the event. Used by useLiveQuery only. */
  topics?: readonly string[];
  /** For payload topics: fold the event into the cached value. Return REFETCH for events it cannot fold. */
  reduce?(current: T, event: LiveEvent): T | typeof REFETCH;
  /** Refetch interval while the socket is not `open` or a topic was denied. Default 15 000; 0 turns polling off. */
  pollMs?: number;
  /** Age after which a new observer, a `foreground` or a resync refetches. Default 30 000. */
  staleMs?: number;
  /** Shortest gap between two refetches caused by events. Default 250; dashboards use 5 000. */
  minRefetchMs?: number;
  /** How long an entry without observers stays cached. Default 300 000. */
  gcMs?: number;
  /** While a hook switches to another key, keep returning its previous data with `loading: true`. Default true for lists. */
  keepPreviousData?: boolean;
  /**
   * Server time (epoch ms) at which the data expires while observed, for short-lived URLs: the entry
   * refetches one minute before it. Used by `fileUrl` and `storeOrderProof`.
   */
  expiresAt?(data: T): number | null;
}

export interface PagedQueryDescriptor<T> extends Omit<
  QueryDescriptor<T[]>,
  'fetch' | 'empty' | 'reduce' | 'keepPreviousData' | 'expiresAt'
> {
  fetchPage(context: QueryContext, cursor: string | null): Promise<Page<T>>;
  idOf(item: T): string;
}

export interface QueryResult<T> {
  /** Latest data. While a changed key loads this is the previous result when `keepPreviousData`. */
  data: T;
  /** True from the render in which the key changed until that key has answered once. */
  loading: boolean;
  /** Set when there is nothing usable to show. */
  error: ApiError | null;
  /** Fetch again now. Wire it to the "Try again" button of ErrorState. */
  retry: () => void;
  /** A refetch is running while `data` is already shown. */
  refreshing: boolean;
  /** When `data` last came from the server, epoch ms. */
  updatedAt: number | null;
}

export interface QueryObservation<T> {
  getResult(): QueryResult<T>;
  unsubscribe(): void;
}

export interface QueryCache {
  /** One cache entry, one fetch in flight and one set of topic subscriptions per key, for any number of observers. */
  observe<T>(query: QueryDescriptor<T>, mode: { live: boolean }, onChange: () => void): QueryObservation<T>;
  getData<T>(key: QueryKey): T | undefined;
  /** Writes server-confirmed data, for example the document a write returned. */
  setData<T>(key: QueryKey, update: T | ((current: T | undefined) => T | undefined)): void;
  /**
   * Marks every entry whose key starts with `prefix` stale; those with observers refetch. The promise
   * settles when those refetches have settled (the optimistic layer waits for it, §1.12).
   */
  invalidate(prefix: QueryKey): Promise<void>;
  invalidateAll(): Promise<void>;
  /** Optimistic layer over the server data (§1.12). Returns the rollback. */
  patch<T>(key: QueryKey, apply: (current: T) => T): () => void;
  prefetch<T>(query: QueryDescriptor<T>): Promise<T>;
  /** Drops every entry whose `auth` is 'required'. The session core calls it whenever the uid changes. */
  clearPrivate(): void;
}
