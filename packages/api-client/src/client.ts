import { type Call, createCall } from './callables';
import { ConfigStoreImpl, type ConfigStore } from './config';
import { SessionCoreImpl, type SessionCore } from './auth/session';
import { TokenManager } from './auth/tokens';
import type { AuthSessionResponse } from './contract';
import { HttpPipeline } from './http';
import { newRequestId } from './ids';
import { LiveClientImpl, liveUrl, type LiveClient } from './live/live-client';
import {
  STORAGE_KEYS,
  systemClock,
  type Clock,
  type KeyValueStorage,
  type Lifecycle,
  type RefreshLock,
  type SecretStorage,
  type WebSocketFactory,
} from './platform';
import { QueryCacheImpl } from './query/query-cache';
import type { QueryCache } from './query/types';
import { createResources, type Resources } from './resources';
import { createRest, type Rest } from './rest';
import { uploadFile, type UploadedFile, type UploadInput } from './uploads';

export interface ApiClientOptions {
  /** Origin of the API: `https://host[:port]`, no trailing slash, no `/api/v1`. */
  baseUrl: string;
  /** Sent as `X-Client: <name>/<version> (<platform>)` on every request. */
  app: { name: 'customer' | 'driver' | 'console'; version: string; platform: 'android' | 'ios' | 'web' };
  secretStorage: SecretStorage;
  cacheStorage: KeyValueStorage;
  lifecycle: Lifecycle;
  /** UUIDv4. Web: crypto.randomUUID. Native: expo-crypto randomUUID. */
  randomUUID: () => string;
  refreshLock?: RefreshLock;
  /** Defaults: globalThis.fetch, globalThis.WebSocket, Date.now with the global timers, Math.random. */
  fetch?: typeof fetch;
  WebSocket?: WebSocketFactory;
  clock?: Clock;
  random?: () => number;
  /** 15 000, 30 000, 120 000 by default. */
  timeouts?: Partial<{ readMs: number; writeMs: number; uploadMs: number }>;
  /** Development logging: requests, refreshes, socket state. Never receives tokens. */
  onDebug?: (event: { type: string; [key: string]: unknown }) => void;
}

export interface ApiClient extends Rest, Resources {
  readonly baseUrl: string;
  readonly session: SessionCore;
  readonly config: ConfigStore;
  readonly live: LiveClient;
  /** Named `cache`, because "store" is a supplier in this domain. */
  readonly cache: QueryCache;
  /** The clock the client runs on (injected in tests); the location publisher throttles with it. */
  readonly clock: Clock;
  /** Typed command: POST /call/<name>. */
  call: Call;
  /** Presigned upload, then confirm. */
  upload(input: UploadInput): Promise<UploadedFile>;
  /** A UUIDv4 for checkoutId, requestId, issueId, message ids and upload ids (decision D17). */
  newRequestId(): string;
  /** Stable id of this install (storage key `instasupply.installationId`); created on first use. */
  installationId(): Promise<string>;
  /** The device clock corrected by the last `serverTime` the server sent (`/config`, `/me`). */
  serverNow(): number;
  /**
   * Restores the session, loads /config, starts the live socket and the lifecycle listeners.
   * Idempotent. Called by ApiProvider. Code that runs without UI (the background location task)
   * does not call it and uses `session.whenRestored()` instead, which opens no socket.
   */
  start(): void;
  /** Stops the socket, timers and listeners. Tests and hot reload. */
  dispose(): void;
}

const DEFAULT_TIMEOUTS = { readMs: 15_000, writeMs: 30_000, uploadMs: 120_000 };

function missingWebSocket(): WebSocketFactory {
  // A runtime without WebSocket (old test runners) still gets a client; the socket then never opens
  // and every live query polls.
  return class {
    readyState = 3;
    onopen = null;
    onmessage = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror = null;
    constructor() {
      throw new Error('WebSocket is not available in this runtime');
    }
    send(): void {}
    close(): void {}
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const clock = options.clock ?? systemClock;
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const WebSocketImpl =
    options.WebSocket ??
    ((globalThis as { WebSocket?: WebSocketFactory }).WebSocket as WebSocketFactory | undefined) ??
    missingWebSocket();
  const random = options.random ?? Math.random;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const xClient = `${options.app.name}/${options.app.version} (${options.app.platform})`;

  let offset = 0;
  const setServerTime = (serverTime: number): void => {
    if (Number.isFinite(serverTime)) offset = serverTime - clock.now();
  };

  let installation: Promise<string> | null = null;
  const installationId = (): Promise<string> => {
    if (!installation) {
      installation = (async () => {
        const existing = await options.cacheStorage.getItem(STORAGE_KEYS.installationId).catch(() => null);
        if (existing) return existing;
        const id = options.randomUUID();
        await options.cacheStorage.setItem(STORAGE_KEYS.installationId, id).catch(() => undefined);
        return id;
      })();
    }
    return installation;
  };

  // The pieces need each other (pipeline → tokens → session → live → cache); `late` closes the loop.
  const late: { session?: SessionCoreImpl; cache?: QueryCacheImpl } = {};

  const http: HttpPipeline = new HttpPipeline({
    baseUrl,
    fetch: fetchImpl,
    clock,
    timeouts,
    xClient,
    onDebug: options.onDebug,
    auth: {
      accessToken: async () => {
        await late.session?.whenTokensRead();
        return tokens.accessToken();
      },
      forceRefresh: (staleToken) => tokens.replaceStale(staleToken),
      onAuthFailure: (error) => late.session?.onAuthEnded(error),
    },
  });

  const tokens = new TokenManager({
    secretStorage: options.secretStorage,
    clock,
    refreshLock: options.refreshLock,
    onDebug: options.onDebug,
    postRefresh: (refreshToken) =>
      http.request<AuthSessionResponse>({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken },
        auth: 'none',
      }),
    onEnded: (error) => late.session?.onAuthEnded(error),
    onRefreshed: (response) => late.session?.onRefreshed(response),
  });

  const session = new SessionCoreImpl({
    http,
    tokens,
    secretStorage: options.secretStorage,
    cacheStorage: options.cacheStorage,
    clock,
    lifecycle: options.lifecycle,
    app: options.app.name,
    installationId,
    setServerTime,
    clearPrivate: () => late.cache?.clearPrivate(),
    onDebug: options.onDebug,
  });
  late.session = session;

  const currentUid = (): string | null => {
    const snapshot = session.getSnapshot();
    return snapshot.status === 'signed_in' ? (snapshot.user?.uid ?? null) : null;
  };

  const live = new LiveClientImpl({
    url: liveUrl(baseUrl),
    WebSocket: WebSocketImpl,
    clock,
    random,
    lifecycle: options.lifecycle,
    onDebug: options.onDebug,
    identity: {
      resolve: async () => {
        await session.whenRestored();
        return currentUid();
      },
      current: currentUid,
      subscribe: (listener) => {
        let last = currentUid();
        return session.subscribe(() => {
          const uid = currentUid();
          if (uid !== last) {
            last = uid;
            listener();
          }
        });
      },
      accessToken: () => tokens.requireAccessToken(),
      onToken: (listener) => tokens.onToken(listener),
      markExpired: () => tokens.markExpired(),
      setKeepFresh: (on) => tokens.setKeepFresh(on),
      onRevoked: () => {
        session.refreshProfile().catch(() => undefined);
      },
    },
  });
  session.attachLive(live);

  const config = new ConfigStoreImpl({
    http,
    cacheStorage: options.cacheStorage,
    clock,
    lifecycle: options.lifecycle,
    setServerTime,
  });

  const rest = createRest(http);

  // `client` is referenced lazily by the cache (descriptors receive it in their context).
  let client: ApiClient | null = null;
  const cache = new QueryCacheImpl({
    client: () => {
      if (!client) throw new Error('ApiClient is not ready');
      return client;
    },
    clock,
    live,
    lifecycle: options.lifecycle,
    session: {
      status: () => session.getSnapshot().status,
      subscribe: (listener) => session.subscribe(listener),
    },
    serverNow: () => clock.now() + offset,
  });
  late.cache = cache;

  const resources = createResources({
    rest,
    invalidate: (prefix) => cache.invalidate(prefix),
    installationId,
  });

  const call = createCall({
    http,
    invalidate: (prefix) => cache.invalidate(prefix),
    invalidateAll: () => cache.invalidateAll(),
    refreshProfile: () => session.refreshProfile(),
  });

  let started = false;
  client = {
    ...rest,
    ...resources,
    baseUrl,
    session,
    config,
    live,
    cache,
    clock,
    call,
    upload: (input) =>
      uploadFile(
        {
          rest,
          fetch: fetchImpl,
          uploadMs: timeouts.uploadMs,
          setTimeout: (run, ms) => clock.setTimeout(run, ms),
          clearTimeout: (handle) => clock.clearTimeout(handle),
        },
        input,
      ),
    newRequestId: () => newRequestId(options.randomUUID),
    installationId,
    serverNow: () => clock.now() + offset,
    start: () => {
      if (started) return;
      started = true;
      session.start();
      config.start();
      live.start();
    },
    dispose: () => {
      started = false;
      live.stop();
      session.dispose();
      config.dispose();
      tokens.dispose();
      cache.dispose();
    },
  };
  return client;
}
