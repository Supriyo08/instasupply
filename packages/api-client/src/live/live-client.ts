import { toApiError } from '../errors';
import type { Clock, Lifecycle, LifecycleEvent, WebSocketFactory, WebSocketLike } from '../platform';

import { POLICY_WAIT_MS, reconnectDelay, STABLE_AFTER_MS } from './backoff';
import { CLOSE, MAX_TOPICS_PER_FRAME, parseServerFrame, type ClientFrame } from './protocol';

export type LiveState =
  | 'stopped' // not started, or disposed
  | 'connecting'
  | 'open' // authenticated (or anonymous) and every subscription sent
  | 'waiting' // closed; a reconnect is scheduled
  | 'offline' // the lifecycle says there is no network; no attempts until it returns
  | 'paused'; // native app in the background; closed on purpose

export interface LiveEvent<D = unknown> {
  topic: string;
  kind: string;
  id: string | null;
  at: number;
  /** Only on payload topics: tracking, driver locations, chat and support messages, notifications. */
  data?: D;
}

export interface LiveClient {
  getState(): LiveState;
  onState(listener: (state: LiveState) => void): () => void;
  /** Reference-counted: the topic is subscribed on the socket while at least one listener exists. */
  subscribe(topic: string, listener: (event: LiveEvent) => void): () => void;
  /** The server refused the topic. Queries bound to it fall back to polling. */
  isDenied(topic: string): boolean;
  /** Fires when the set of denied topics changes, so bound queries can start or stop polling. */
  onDenied(listener: () => void): () => void;
  /** Fires after each successful (re)connection once every topic has been sent again: events may have been missed. */
  onResync(listener: () => void): () => void;
  start(): void;
  stop(): void;
}

/** What the live client needs to know about the session; `createApiClient` adapts the session core. */
export interface LiveIdentity {
  /** The uid to authenticate as, or null for an anonymous socket. Waits for the session restore. */
  resolve(): Promise<string | null>;
  /** The uid right now, without waiting. */
  current(): string | null;
  subscribe(listener: () => void): () => void;
  accessToken(): Promise<string>;
  onToken(listener: (token: string) => void): () => void;
  markExpired(): void;
  /** While the socket is open and signed in, the token manager refreshes ahead of the deadline. */
  setKeepFresh(on: boolean): void;
  /** Close 4403: let the session core check `/me`, which ends the session through the normal path. */
  onRevoked(): void;
}

export interface LiveClientOptions {
  url: string;
  WebSocket: WebSocketFactory;
  clock: Clock;
  random: () => number;
  lifecycle: Lifecycle;
  identity: LiveIdentity;
  onDebug?: (event: { type: string; [key: string]: unknown }) => void;
}

export const HEARTBEAT_MS = 25_000;
/** A ping older than this without any frame since means the socket is dead. */
export const HEARTBEAT_DEAD_MS = 20_000;
/** The last listener of a topic leaving unsubscribes after this, so a quick remount does not flap. */
export const UNSUBSCRIBE_GRACE_MS = 2_000;
/** A native app this long in the background closes its socket; system push covers alerts. */
export const BACKGROUND_PAUSE_MS = 20_000;

const WS_OPEN = 1;

interface Subscription {
  listener: (event: LiveEvent) => void;
}

export function liveUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/api/v1/live`;
}

export class LiveClientImpl implements LiveClient {
  private state: LiveState = 'stopped';
  private ws: WebSocketLike | null = null;
  /** Bumped whenever a socket is abandoned on purpose: its late callbacks are ignored. */
  private socketGen = 0;
  /** The identity of the current or pending connection; undefined while it is being resolved. */
  private connectionUid: string | null | undefined = undefined;
  private authedUid: string | null = null;
  private authPending = false;
  private attempt = 0;
  private consecutiveExpired = 0;
  private frameId = 0;

  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private stableTimer: unknown = null;
  private pauseTimer: unknown = null;
  private lastPingAt: number | null = null;
  private frameSincePing = true;

  private readonly topics = new Map<string, Set<Subscription>>();
  private readonly unsubscribeTimers = new Map<string, unknown>();
  private readonly sent = new Set<string>();
  private readonly pending = new Set<string>();
  private flushQueued = false;
  private readonly denied = new Set<string>();

  private readonly stateListeners = new Set<(state: LiveState) => void>();
  private readonly resyncListeners = new Set<() => void>();
  private readonly deniedListeners = new Set<() => void>();
  private disposers: (() => void)[] = [];

  constructor(private readonly options: LiveClientOptions) {}

  getState(): LiveState {
    return this.state;
  }

  onState(listener: (state: LiveState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onResync(listener: () => void): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  onDenied(listener: () => void): () => void {
    this.deniedListeners.add(listener);
    return () => this.deniedListeners.delete(listener);
  }

  isDenied(topic: string): boolean {
    return this.denied.has(topic);
  }

  subscribe(topic: string, listener: (event: LiveEvent) => void): () => void {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    const timer = this.unsubscribeTimers.get(topic);
    if (timer !== undefined) {
      this.options.clock.clearTimeout(timer);
      this.unsubscribeTimers.delete(topic);
    }
    const subscription: Subscription = { listener };
    set.add(subscription);
    if (this.state === 'open' && !this.sent.has(topic)) {
      this.pending.add(topic);
      this.queueFlush();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(subscription);
      if (set.size === 0) this.scheduleUnsubscribe(topic);
    };
  }

  start(): void {
    if (this.state !== 'stopped') return;
    const { lifecycle, identity } = this.options;
    this.disposers = [
      lifecycle.subscribe((event) => this.onLifecycle(event)),
      identity.subscribe(() => this.onIdentityChange()),
      identity.onToken((token) => this.onToken(token)),
    ];
    this.setState('connecting');
    void this.connect();
  }

  stop(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.closeSocket();
    this.clearTimer('reconnectTimer');
    this.clearTimer('pauseTimer');
    for (const timer of this.unsubscribeTimers.values()) this.options.clock.clearTimeout(timer);
    this.unsubscribeTimers.clear();
    this.setState('stopped');
  }

  // ---------- connection ----------

  private async connect(): Promise<void> {
    if (this.state === 'stopped') return;
    this.clearTimer('reconnectTimer');
    if (!this.options.lifecycle.isOnline()) {
      this.closeSocket();
      this.setState('offline');
      return;
    }
    this.closeSocket();
    const gen = ++this.socketGen;
    this.connectionUid = undefined;
    this.setState('connecting');
    const uid = await this.options.identity.resolve();
    if (gen !== this.socketGen || this.state !== 'connecting') return;
    this.connectionUid = uid;
    let ws: WebSocketLike;
    try {
      ws = new this.options.WebSocket(this.options.url);
    } catch (error) {
      this.debug({ type: 'live.construct-failed', message: toApiError(error).message });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.sent.clear();
    this.authedUid = null;
    ws.onopen = () => void this.onOpen(gen, uid);
    ws.onmessage = (event) => this.onMessage(gen, event.data);
    ws.onclose = (event) => this.onClose(gen, event.code);
    ws.onerror = () => {
      // A close event always follows; the reconnect is decided there.
    };
  }

  private async onOpen(gen: number, uid: string | null): Promise<void> {
    if (gen !== this.socketGen) return;
    this.startHeartbeat();
    if (uid === null) {
      this.afterReady(gen);
      return;
    }
    try {
      const token = await this.options.identity.accessToken();
      if (gen !== this.socketGen) return;
      this.authPending = true;
      this.send({ type: 'auth', token });
    } catch (error) {
      if (gen !== this.socketGen) return;
      // No token (offline refresh, or the session just ended): drop this socket; the identity listener or
      // the backoff brings the next one.
      this.debug({ type: 'live.auth-unavailable', status: toApiError(error).status });
      this.closeSocket();
      if (this.state !== 'stopped') this.scheduleReconnect();
    }
  }

  private afterReady(gen: number): void {
    if (gen !== this.socketGen) return;
    this.pending.clear();
    const all = [...this.topics.entries()].filter(([, set]) => set.size > 0).map(([topic]) => topic);
    this.sendSubscribe(all);
    this.consecutiveExpired = 0;
    this.setState('open');
    this.options.identity.setKeepFresh(this.authedUid !== null);
    this.clearTimer('stableTimer');
    this.stableTimer = this.options.clock.setTimeout(() => {
      this.stableTimer = null;
      if (this.state === 'open') this.attempt = 0;
    }, STABLE_AFTER_MS);
    for (const listener of [...this.resyncListeners]) listener();
  }

  private onMessage(gen: number, data: unknown): void {
    if (gen !== this.socketGen) return;
    this.frameSincePing = true;
    const frame = parseServerFrame(data);
    if (!frame) return;
    switch (frame.type) {
      case 'ready':
        if (this.authPending) {
          this.authPending = false;
          this.authedUid = frame.uid;
          this.afterReady(gen);
        }
        return;
      case 'subscribed': {
        let changed = false;
        for (const topic of frame.topics) changed = this.denied.delete(topic) || changed;
        for (const { topic, reason } of frame.denied) {
          if (!this.denied.has(topic)) {
            this.denied.add(topic);
            changed = true;
            this.debug({ type: 'live.denied', topic, reason });
          }
        }
        if (changed) for (const listener of [...this.deniedListeners]) listener();
        return;
      }
      case 'event': {
        const set = this.topics.get(frame.topic);
        if (!set) return;
        const event: LiveEvent = { topic: frame.topic, kind: frame.kind, id: frame.id, at: frame.at };
        if ('data' in frame) event.data = frame.data;
        for (const subscription of [...set]) subscription.listener(event);
        return;
      }
      case 'error':
        this.debug({ type: 'live.error-frame', status: frame.status, reason: frame.reason });
        if (frame.reason === 'token_expired') this.options.identity.markExpired();
        return;
      case 'pong':
        return;
    }
  }

  private onClose(gen: number, code: number): void {
    if (gen !== this.socketGen) return;
    this.ws = null;
    this.stopSocketTimers();
    this.sent.clear();
    this.authPending = false;
    this.options.identity.setKeepFresh(false);
    this.debug({ type: 'live.closed', code });
    if (this.state === 'stopped' || this.state === 'offline' || this.state === 'paused') return;
    switch (code) {
      case CLOSE.tokenExpired:
        this.options.identity.markExpired();
        this.consecutiveExpired += 1;
        // Refresh and reconnect at once, but a token the server keeps refusing must not loop hot.
        if (this.consecutiveExpired <= 1) void this.connect();
        else this.scheduleReconnect();
        return;
      case CLOSE.revoked:
        this.options.identity.onRevoked();
        this.scheduleReconnect();
        return;
      case CLOSE.policy:
        this.setState('waiting');
        this.reconnectTimer = this.options.clock.setTimeout(() => {
          this.reconnectTimer = null;
          void this.connect();
        }, POLICY_WAIT_MS);
        return;
      default:
        this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.clearTimer('reconnectTimer');
    const delay = reconnectDelay(this.attempt, this.options.random);
    this.attempt += 1;
    this.setState('waiting');
    this.debug({ type: 'live.reconnect-scheduled', delay, attempt: this.attempt });
    this.reconnectTimer = this.options.clock.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  /** Abandons the current socket on purpose: its close event is ignored. */
  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.socketGen += 1;
    this.stopSocketTimers();
    this.sent.clear();
    this.authPending = false;
    this.authedUid = null;
    this.options.identity.setKeepFresh(false);
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close(1000, 'client');
      } catch {
        // Already closing.
      }
    }
  }

  // ---------- heartbeat ----------

  private startHeartbeat(): void {
    this.clearTimer('heartbeatTimer');
    this.lastPingAt = null;
    this.frameSincePing = true;
    this.heartbeatTimer = this.options.clock.setTimeout(() => this.heartbeat(), HEARTBEAT_MS);
  }

  /**
   * Tied to the ping, not to wall-clock silence: a hidden browser tab whose timers run once a minute
   * still receives the pong of its previous ping and keeps its socket.
   */
  private heartbeat(): void {
    this.heartbeatTimer = null;
    if (!this.ws) return;
    const now = this.options.clock.now();
    if (this.lastPingAt !== null && !this.frameSincePing && now - this.lastPingAt >= HEARTBEAT_DEAD_MS) {
      this.debug({ type: 'live.heartbeat-timeout' });
      this.closeSocket();
      this.scheduleReconnect();
      return;
    }
    this.send({ type: 'ping' });
    this.lastPingAt = now;
    this.frameSincePing = false;
    this.heartbeatTimer = this.options.clock.setTimeout(() => this.heartbeat(), HEARTBEAT_MS);
  }

  // ---------- topics ----------

  private scheduleUnsubscribe(topic: string): void {
    if (this.unsubscribeTimers.has(topic)) return;
    const timer = this.options.clock.setTimeout(() => {
      this.unsubscribeTimers.delete(topic);
      const set = this.topics.get(topic);
      if (set && set.size > 0) return;
      this.topics.delete(topic);
      this.pending.delete(topic);
      if (this.denied.delete(topic)) for (const listener of [...this.deniedListeners]) listener();
      if (this.sent.delete(topic) && this.state === 'open')
        this.send({ type: 'unsubscribe', topics: [topic] });
    }, UNSUBSCRIBE_GRACE_MS);
    this.unsubscribeTimers.set(topic, timer);
  }

  /** New topics while open go out in one frame per tick. */
  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      if (this.state !== 'open') return;
      const topics = [...this.pending].filter((topic) => (this.topics.get(topic)?.size ?? 0) > 0);
      this.pending.clear();
      this.sendSubscribe(topics.filter((topic) => !this.sent.has(topic)));
    });
  }

  private sendSubscribe(topics: string[]): void {
    for (let i = 0; i < topics.length; i += MAX_TOPICS_PER_FRAME) {
      const chunk = topics.slice(i, i + MAX_TOPICS_PER_FRAME);
      this.frameId += 1;
      this.send({ type: 'subscribe', id: this.frameId, topics: chunk });
      for (const topic of chunk) this.sent.add(topic);
    }
  }

  // ---------- outside events ----------

  private onLifecycle(event: LifecycleEvent): void {
    if (this.state === 'stopped') return;
    switch (event) {
      case 'offline':
        this.closeSocket();
        this.clearTimer('reconnectTimer');
        this.setState('offline');
        return;
      case 'online':
        if (this.state === 'offline' || this.state === 'waiting') {
          this.attempt = 0;
          void this.connect();
        }
        return;
      case 'background':
        this.clearTimer('pauseTimer');
        this.pauseTimer = this.options.clock.setTimeout(() => {
          this.pauseTimer = null;
          if (this.options.lifecycle.isForeground() || this.state === 'stopped') return;
          this.closeSocket();
          this.clearTimer('reconnectTimer');
          this.setState('paused');
        }, BACKGROUND_PAUSE_MS);
        return;
      case 'foreground':
        this.clearTimer('pauseTimer');
        if (this.state === 'paused' || this.state === 'waiting') {
          this.attempt = 0;
          void this.connect();
        }
        return;
    }
  }

  /** Sign-in, sign-out, account change: a new socket under the new identity. */
  private onIdentityChange(): void {
    if (this.state === 'stopped' || this.state === 'offline' || this.state === 'paused') return;
    if (this.connectionUid === undefined) return; // a connection is resolving the identity right now
    if (this.options.identity.current() === this.connectionUid) return;
    if (this.denied.size > 0) {
      this.denied.clear();
      for (const listener of [...this.deniedListeners]) listener();
    }
    this.attempt = 0;
    void this.connect();
  }

  /** A refreshed token goes to the open socket as a new `auth`: no reconnect, no resync. */
  private onToken(token: string): void {
    if (this.state !== 'open' || this.authedUid === null) return;
    if (this.options.identity.current() !== this.authedUid) return;
    this.send({ type: 'auth', token });
  }

  // ---------- helpers ----------

  private send(frame: ClientFrame): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // The close event follows.
    }
  }

  private stopSocketTimers(): void {
    this.clearTimer('heartbeatTimer');
    this.clearTimer('stableTimer');
  }

  private clearTimer(name: 'reconnectTimer' | 'heartbeatTimer' | 'stableTimer' | 'pauseTimer'): void {
    const handle = this[name];
    if (handle !== null) {
      this.options.clock.clearTimeout(handle);
      this[name] = null;
    }
  }

  private setState(state: LiveState): void {
    if (this.state === state) return;
    this.state = state;
    this.debug({ type: 'live.state', state });
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private debug(event: { type: string; [key: string]: unknown }): void {
    this.options.onDebug?.(event);
  }
}
