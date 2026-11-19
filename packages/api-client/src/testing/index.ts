/**
 * Test kit (CLIENTS §1.13): a fake server with auth, rotation and reuse detection, a fake socket, a fake
 * clock, memory storage and a fake lifecycle. No network, no port, no real timer. The apps and the
 * console use it for their own hook tests too.
 */
import type { UserProfile } from '@instasupply/shared';

import { createApiClient, type ApiClient, type ApiClientOptions } from '../client';
import type { AuthSessionResponse, MeResponse } from '../contract';
import { statusForHttp, type ApiErrorInit, type ApiErrorStatus, type AuthFailureReason } from '../errors';
import type { LiveEvent } from '../live/live-client';
import type { ClientFrame } from '../live/protocol';
import type {
  Clock,
  Lifecycle,
  LifecycleEvent,
  SecretStorage,
  WebSocketFactory,
  WebSocketLike,
} from '../platform';

// ---------- clock ----------

export interface FakeClock extends Clock {
  /** Runs every timer due within `ms`, in order, awaiting microtasks between them. */
  advance(ms: number): Promise<void>;
  /** Timers still waiting (diagnostics). */
  pending(): number;
}

/** Lets every queued promise continuation run: one macrotask turn drains the microtask queue. */
export async function flushMicrotasks(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

export function createFakeClock(startAt = Date.UTC(2026, 10, 20, 15, 0, 0)): FakeClock {
  let now = startAt;
  let seq = 0;
  const timers = new Map<number, { at: number; seq: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout(run, ms) {
      seq += 1;
      timers.set(seq, { at: now + Math.max(0, ms), seq, run });
      return seq;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    async advance(ms) {
      const target = now + ms;
      await flushMicrotasks();
      for (;;) {
        let next: { id: number; at: number; seq: number; run: () => void } | null = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (!next || timer.at < next.at || (timer.at === next.at && timer.seq < next.seq))
            next = { id, ...timer };
        }
        if (!next) break;
        timers.delete(next.id);
        now = Math.max(now, next.at);
        next.run();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    },
  };
}

// ---------- storage and lifecycle ----------

/** Two clients given the same instance behave like two browser tabs: `onExternalChange` fires in the other one. */
export function createMemoryStorage(
  initial: Record<string, string> = {},
): SecretStorage & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  const listeners = new Set<(key: string, value: string | null) => void>();
  const notify = (key: string, value: string | null): void => {
    // Like the browser's `storage` event: asynchronous. Every listener hears it; the writer recognises
    // its own write (TokenManager.isOwnWrite), as a browser tab never receives its own event.
    queueMicrotask(() => {
      for (const listener of [...listeners]) listener(key, value);
    });
  };
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
      notify(key, value);
    },
    removeItem: async (key) => {
      if (!data.has(key)) return;
      data.delete(key);
      notify(key, null);
    },
    onExternalChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dump: () => Object.fromEntries(data),
  };
}

export function createFakeLifecycle(
  initial: { foreground?: boolean; online?: boolean } = {},
): Lifecycle & { emit(event: LifecycleEvent): void } {
  let foreground = initial.foreground ?? true;
  let online = initial.online ?? true;
  const listeners = new Set<(event: LifecycleEvent) => void>();
  return {
    isForeground: () => foreground,
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      if (event === 'foreground') foreground = true;
      if (event === 'background') foreground = false;
      if (event === 'online') online = true;
      if (event === 'offline') online = false;
      for (const listener of [...listeners]) listener(event);
    },
  };
}

// ---------- fake server ----------

export interface FakeRequest {
  method: string;
  /** Below /api/v1 (or the full URL for a target outside the API, such as a storage form). */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
  /** The authenticated caller, or null for an anonymous request. */
  uid: string | null;
}

export type FakeAnswer = { status?: number; body?: unknown; headers?: Record<string, string> } | ApiErrorInit;

type Handler = (request: FakeRequest, params: Record<string, string>) => FakeAnswer | Promise<FakeAnswer>;

export interface FakeServer {
  /** Pass both to createApiClient. */
  fetch: typeof fetch;
  WebSocket: WebSocketFactory;
  /** Route handler; `path` may contain `:params`. Later registrations win. A path starting with `http` matches a full URL. */
  on(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, handler: Handler): void;
  /** Implements /auth/* and /me for one account with rotation and reuse detection. */
  addAccount(input: { email: string; password: string; profile: UserProfile | null }): { uid: string };
  expireAccessTokens(): void;
  revokeSessions(uid: string, reason: AuthFailureReason): void;
  /** The next `count` requests fail before any handler runs. */
  failNext(count: number, how: 'network' | 'timeout' | 502 | 503): void;
  /** Loses the answers of the next `count` requests after their handlers ran (a lost refresh answer). */
  dropAnswers(count: number): void;
  /** Sends an event frame to every socket subscribed to its topic. */
  emit(event: LiveEvent): void;
  closeSockets(code?: number): void;
  refuseSockets(refuse: boolean): void;
  denyTopic(topic: string): void;
  /** While true, sockets accept frames but answer nothing (a half-open connection). */
  stallSockets(stall: boolean): void;
  readonly requests: FakeRequest[];
  /** Every frame a client sent, with the number of the socket that sent it. */
  readonly frames: { socket: number; frame: ClientFrame }[];
  subscribedTopics(): string[];
  /** Sockets currently open. */
  openSockets(): number;
  /** Sockets ever constructed. */
  socketCount(): number;
  /** Access-token lifetime in seconds (default 900). */
  accessTokenTtlSeconds: number;
}

const HTTP_FOR: Record<ApiErrorStatus, number> = {
  'invalid-argument': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'failed-precondition': 412,
  'resource-exhausted': 429,
  internal: 500,
  unavailable: 503,
  'deadline-exceeded': 504,
  cancelled: 499,
};

const PUBLIC_TOPIC = /^(categories|stores|store:[^:]+|store:[^:]+:products|product:.+|tracking:.+)$/;

interface Account {
  uid: string;
  email: string;
  password: string;
  profile: UserProfile | null;
  createdAt: number;
  suspended: boolean;
}
interface SessionRow {
  sid: string;
  uid: string;
  revoked: AuthFailureReason | null;
}
interface RefreshRow {
  sid: string;
  used: boolean;
  superseded: boolean;
  parent: string | null;
  children: string[];
}
interface AccessRow {
  uid: string;
  sid: string;
  expiresAt: number;
}

function isErrorInit(answer: FakeAnswer): answer is ApiErrorInit {
  return typeof (answer as { status?: unknown }).status === 'string';
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export function createFakeServer(options: { clock?: Clock } = {}): FakeServer {
  const clock: Clock = options.clock ?? {
    now: Date.now,
    setTimeout,
    clearTimeout: (h) => clearTimeout(h as never),
  };
  const routes: { method: string; pattern: RegExp; keys: string[]; absolute: boolean; handler: Handler }[] =
    [];
  const failures: ('network' | 'timeout' | 502 | 503)[] = [];
  let drops = 0;
  const requests: FakeRequest[] = [];
  const frames: { socket: number; frame: ClientFrame }[] = [];
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, SessionRow>();
  const refreshTokens = new Map<string, RefreshRow>();
  const accessTokens = new Map<string, AccessRow>();
  const sockets = new Set<FakeSocket>();
  const deniedTopics = new Set<string>();
  let refuse = false;
  let stalled = false;
  let counter = 0;
  let socketSeq = 0;
  const next = (prefix: string): string => `${prefix}${(counter += 1)}`;

  const server: FakeServer = {
    fetch: fakeFetch as typeof fetch,
    WebSocket: undefined as unknown as WebSocketFactory,
    requests,
    frames,
    accessTokenTtlSeconds: 900,
    on(method, path, handler) {
      const keys: string[] = [];
      const absolute = path.startsWith('http');
      const source = path
        .split('/')
        .map((part) => {
          if (part.startsWith(':')) {
            keys.push(part.slice(1));
            return '([^/]+)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
      routes.push({ method, pattern: new RegExp(`^${source}$`), keys, absolute, handler });
    },
    addAccount(input) {
      const uid = next('u_');
      accounts.set(uid, {
        uid,
        email: input.email.toLowerCase(),
        password: input.password,
        profile: input.profile,
        createdAt: clock.now(),
        suspended: false,
      });
      return { uid };
    },
    expireAccessTokens() {
      for (const row of accessTokens.values()) row.expiresAt = Math.min(row.expiresAt, clock.now() - 1);
    },
    revokeSessions(uid, reason) {
      const account = accounts.get(uid);
      if (account && reason === 'account_suspended') account.suspended = true;
      for (const row of sessions.values()) if (row.uid === uid) row.revoked = reason;
      for (const socket of sockets) if (socket.uid === uid) socket.serverClose(4403);
    },
    failNext(count, how) {
      for (let i = 0; i < count; i += 1) failures.push(how);
    },
    dropAnswers(count) {
      drops += count;
    },
    emit(event) {
      for (const socket of sockets) {
        if (!socket.topics.has(event.topic)) continue;
        socket.deliver({ type: 'event', ...event });
      }
    },
    closeSockets(code = 1012) {
      for (const socket of [...sockets]) socket.serverClose(code);
    },
    refuseSockets(value) {
      refuse = value;
    },
    denyTopic(topic) {
      deniedTopics.add(topic);
    },
    stallSockets(value) {
      stalled = value;
    },
    subscribedTopics() {
      const all = new Set<string>();
      for (const socket of sockets)
        if (socket.readyState === 1) for (const topic of socket.topics) all.add(topic);
      return [...all].sort();
    },
    openSockets: () => [...sockets].filter((socket) => socket.readyState === 1).length,
    socketCount: () => socketSeq,
  };

  // ---------- auth helpers ----------

  function issue(uid: string, sid: string, parent: string | null): AuthSessionResponse {
    const refreshToken = next('isr_');
    refreshTokens.set(refreshToken, { sid, used: false, superseded: false, parent, children: [] });
    if (parent) refreshTokens.get(parent)?.children.push(refreshToken);
    const accessToken = next('at_');
    accessTokens.set(accessToken, { uid, sid, expiresAt: clock.now() + server.accessTokenTtlSeconds * 1000 });
    return {
      accessToken,
      accessTokenTtlSeconds: server.accessTokenTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt: clock.now() + 60 * 86_400_000,
      sessionId: sid,
      me: meOf(uid),
    };
  }

  function meOf(uid: string): MeResponse {
    const account = accounts.get(uid);
    if (!account) throw new Error(`unknown account ${uid}`);
    return {
      account: { uid, email: account.email, createdAt: account.createdAt },
      profile: account.profile,
      store: null,
      serverTime: clock.now(),
    };
  }

  function authError(
    status: 'unauthenticated' | 'permission-denied',
    reason: AuthFailureReason,
  ): ApiErrorInit {
    const messages: Record<AuthFailureReason, string> = {
      token_expired: 'Your session has expired.',
      token_invalid: 'Sign in to continue.',
      session_revoked: 'Your session has ended.',
      refresh_reused: 'Your session has ended.',
      account_suspended: 'Your account is suspended. Contact InstaSupply support.',
      credentials: 'That email and password combination is incorrect.',
    };
    return { status, message: messages[reason], details: { reason } };
  }

  /** PLATFORM §6.4: suspension is answered before revocation. */
  function checkAccess(token: string): { uid: string } | ApiErrorInit {
    const row = accessTokens.get(token);
    if (!row) return authError('unauthenticated', 'token_invalid');
    if (clock.now() >= row.expiresAt) return authError('unauthenticated', 'token_expired');
    const account = accounts.get(row.uid);
    if (account?.suspended) return authError('permission-denied', 'account_suspended');
    const session = sessions.get(row.sid);
    if (!session || session.revoked) return authError('unauthenticated', 'session_revoked');
    return { uid: row.uid };
  }

  function newSession(uid: string): AuthSessionResponse {
    const sid = next('s_');
    sessions.set(sid, { sid, uid, revoked: null });
    return issue(uid, sid, null);
  }

  const body = (request: FakeRequest): Record<string, unknown> =>
    request.body !== null && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)
      : {};

  server.on('POST', '/auth/register', (request) => {
    const input = body(request);
    const email = String(input.email ?? '').toLowerCase();
    if ([...accounts.values()].some((account) => account.email === email)) {
      return {
        status: 'already-exists',
        message: 'An account with this email already exists. Try signing in.',
      };
    }
    const { uid } = server.addAccount({ email, password: String(input.password ?? ''), profile: null });
    return { body: newSession(uid) };
  });

  server.on('POST', '/auth/login', (request) => {
    const input = body(request);
    const email = String(input.email ?? '').toLowerCase();
    const account = [...accounts.values()].find((candidate) => candidate.email === email);
    if (!account || account.password !== input.password) return authError('unauthenticated', 'credentials');
    if (account.suspended) return authError('permission-denied', 'account_suspended');
    return { body: newSession(account.uid) };
  });

  /** PLATFORM §6.3.5: rotation, repeat after a lost answer, reuse detection. */
  server.on('POST', '/auth/refresh', (request) => {
    const token = String(body(request).refreshToken ?? '');
    const row = refreshTokens.get(token);
    if (!row) return authError('unauthenticated', 'token_invalid');
    const session = sessions.get(row.sid);
    if (!session) return authError('unauthenticated', 'token_invalid');
    const account = accounts.get(session.uid);
    if (account?.suspended || session.revoked === 'account_suspended') {
      return authError('permission-denied', 'account_suspended');
    }
    if (session.revoked) return authError('unauthenticated', 'session_revoked');
    const reuse = (): ApiErrorInit => {
      session.revoked = 'refresh_reused';
      for (const socket of sockets) if (socket.sid === session.sid) socket.serverClose(4403);
      return authError('unauthenticated', 'refresh_reused');
    };
    if (row.superseded) return reuse();
    if (!row.used) {
      row.used = true;
      if (row.parent) {
        for (const sibling of refreshTokens.get(row.parent)?.children ?? []) {
          const other = refreshTokens.get(sibling);
          if (sibling !== token && other && !other.used) other.superseded = true;
        }
      }
      return { body: issue(session.uid, session.sid, token) };
    }
    const childUsed = row.children.some((child) => refreshTokens.get(child)?.used);
    if (childUsed || row.children.length >= 5) return reuse();
    // A repeat: the answer was lost; another child, as long as no child was used.
    return { body: issue(session.uid, session.sid, token) };
  });

  server.on('POST', '/auth/logout', (request) => {
    const row = refreshTokens.get(String(body(request).refreshToken ?? ''));
    const session = row ? sessions.get(row.sid) : undefined;
    if (session && !session.revoked) session.revoked = 'session_revoked';
    return { status: 204 };
  });

  server.on('POST', '/auth/logout-all', (request) => {
    if (!request.uid) return authError('unauthenticated', 'token_invalid');
    for (const session of sessions.values())
      if (session.uid === request.uid) session.revoked = 'session_revoked';
    return { status: 204 };
  });

  server.on('GET', '/me', (request) => {
    if (!request.uid) return authError('unauthenticated', 'token_invalid');
    return { body: meOf(request.uid) };
  });

  server.on('PATCH', '/me', (request) => {
    if (!request.uid) return authError('unauthenticated', 'token_invalid');
    const account = accounts.get(request.uid);
    const patch = body(request);
    if (account?.profile && typeof patch.displayName === 'string') {
      account.profile = { ...account.profile, displayName: patch.displayName };
    }
    return { body: meOf(request.uid) };
  });

  server.on('GET', '/config', () => ({
    body: {
      environment: 'development',
      paymentsMode: 'test',
      phoneVerification: 'optional',
      supportPhone: null,
      supportEmail: null,
      hstNumber: null,
      map: { tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: 'OSM', maxZoom: 19 },
      trackingBaseUrl: 'https://app.test/track',
      smsDriver: 'outbox',
      emailDriver: 'outbox',
      allowTestJobs: true,
      serverTime: clock.now(),
    },
  }));

  // ---------- fetch ----------

  async function readBody(init: RequestInit | undefined): Promise<unknown> {
    const raw = init?.body;
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const apiAt = url.pathname.indexOf('/api/v1');
    const path = apiAt >= 0 ? url.pathname.slice(apiAt + '/api/v1'.length) : `${url.origin}${url.pathname}`;
    const signal = init?.signal ?? undefined;

    const failure = failures.shift();
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure === 'timeout') {
      return new Promise<Response>((_, reject) => {
        if (signal?.aborted) reject(abortError());
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    if (failure === 502 || failure === 503) {
      return new Response('<html>Bad gateway</html>', {
        status: failure,
        headers: { 'content-type': 'text/html' },
      });
    }

    let uid: string | null = null;
    let answer: FakeAnswer | null = null;
    const authorization = headers.get('authorization');
    if (authorization?.startsWith('Bearer ')) {
      const checked = checkAccess(authorization.slice('Bearer '.length));
      if ('uid' in checked) uid = checked.uid;
      else answer = checked;
    }
    const request: FakeRequest = {
      method,
      path,
      query: url.searchParams,
      headers,
      body: await readBody(init),
      uid,
    };
    requests.push(request);

    if (!answer) {
      const route = [...routes]
        .reverse()
        .find(
          (candidate) =>
            candidate.method === method &&
            candidate.absolute === path.startsWith('http') &&
            candidate.pattern.test(path),
        );
      if (!route) {
        answer = { status: 'not-found', message: `No route for ${method} ${path}` };
      } else {
        const match = route.pattern.exec(path);
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(match?.[i + 1] ?? '');
        });
        answer = await route.handler(request, params);
      }
    }
    if (drops > 0) {
      drops -= 1;
      throw new TypeError('fetch failed (answer lost)');
    }
    if (signal?.aborted) throw abortError();
    const requestId = next('req_');
    if (isErrorInit(answer)) {
      const status = HTTP_FOR[answer.status] ?? 500;
      const envelope = {
        error: {
          status: answer.status,
          code: answer.code ?? null,
          message: answer.message,
          details: answer.details ?? {},
        },
      };
      return new Response(JSON.stringify(envelope), {
        status,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      });
    }
    const status = answer.status ?? (answer.body === undefined ? 204 : 200);
    const text = answer.body === undefined || status === 204 ? null : JSON.stringify(answer.body);
    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': requestId, ...answer.headers },
    });
  }

  // ---------- socket ----------

  class FakeSocket implements WebSocketLike {
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readonly id: number;
    uid: string | null = null;
    sid: string | null = null;
    token: string | null = null;
    readonly topics = new Set<string>();
    private expiryTimer: unknown = null;

    constructor(readonly url: string) {
      socketSeq += 1;
      this.id = socketSeq;
      sockets.add(this);
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        if (refuse) {
          this.finish(1006);
          return;
        }
        this.readyState = 1;
        this.onopen?.({});
      });
    }

    send(data: string): void {
      if (this.readyState !== 1) throw new Error('socket not open');
      const frame = JSON.parse(data) as ClientFrame;
      frames.push({ socket: this.id, frame });
      if (stalled) return;
      switch (frame.type) {
        case 'ping':
          this.deliver({ type: 'pong' });
          return;
        case 'auth': {
          const checked = checkAccess(frame.token);
          if (!('uid' in checked)) {
            this.deliver({ type: 'error', status: checked.status, reason: checked.details?.reason });
            this.serverClose(checked.status === 'permission-denied' ? 4403 : 4401);
            return;
          }
          if (this.uid !== null && this.uid !== checked.uid) {
            this.serverClose(4403);
            return;
          }
          const row = accessTokens.get(frame.token);
          this.uid = checked.uid;
          this.sid = row?.sid ?? null;
          this.token = frame.token;
          // PLATFORM §8.1: a token expired more than 30 s ago without a new `auth` closes with 4401.
          if (this.expiryTimer !== null) clock.clearTimeout(this.expiryTimer);
          const token = frame.token;
          this.expiryTimer = clock.setTimeout(
            () => {
              if (this.token === token && this.readyState === 1) this.serverClose(4401);
            },
            Math.max(0, (row?.expiresAt ?? clock.now()) + 30_000 - clock.now()),
          );
          this.deliver({ type: 'ready', uid: checked.uid });
          return;
        }
        case 'subscribe': {
          const granted: string[] = [];
          const denied: { topic: string; reason: string }[] = [];
          for (const topic of frame.topics) {
            if (deniedTopics.has(topic)) denied.push({ topic, reason: 'permission-denied' });
            else if (this.uid === null && !PUBLIC_TOPIC.test(topic))
              denied.push({ topic, reason: 'unauthenticated' });
            else {
              this.topics.add(topic);
              granted.push(topic);
            }
          }
          this.deliver({ type: 'subscribed', id: frame.id, topics: granted, denied });
          return;
        }
        case 'unsubscribe':
          for (const topic of frame.topics) this.topics.delete(topic);
          return;
      }
    }

    close(code = 1000, reason = ''): void {
      if (this.readyState === 3) return;
      this.finish(code, reason);
    }

    deliver(frame: unknown): void {
      if (this.readyState !== 1 || stalled) return;
      const data = JSON.stringify(frame);
      queueMicrotask(() => {
        if (this.readyState === 1) this.onmessage?.({ data });
      });
    }

    serverClose(code: number): void {
      if (this.readyState === 3) return;
      this.finish(code);
    }

    private finish(code: number, reason = ''): void {
      this.readyState = 3;
      sockets.delete(this);
      if (this.expiryTimer !== null) clock.clearTimeout(this.expiryTimer);
      queueMicrotask(() => this.onclose?.({ code, reason }));
    }
  }

  server.WebSocket = FakeSocket;
  return server;
}

// ---------- the wired client ----------

/** A client wired to a fake server, a fake clock, memory storages and a fake lifecycle. */
export function createTestClient(
  overrides: Partial<ApiClientOptions> & { server?: FakeServer; clock?: FakeClock } = {},
): {
  client: ApiClient;
  server: FakeServer;
  clock: FakeClock;
  lifecycle: ReturnType<typeof createFakeLifecycle>;
  secrets: ReturnType<typeof createMemoryStorage>;
  cache: ReturnType<typeof createMemoryStorage>;
} {
  const clock = overrides.clock ?? createFakeClock();
  const server = overrides.server ?? createFakeServer({ clock });
  const secrets =
    (overrides.secretStorage as ReturnType<typeof createMemoryStorage> | undefined) ?? createMemoryStorage();
  const cache =
    (overrides.cacheStorage as ReturnType<typeof createMemoryStorage> | undefined) ?? createMemoryStorage();
  const lifecycle =
    (overrides.lifecycle as ReturnType<typeof createFakeLifecycle> | undefined) ?? createFakeLifecycle();
  let uuid = 0;
  const { server: _server, ...rest } = overrides;
  const client = createApiClient({
    baseUrl: 'https://api.test',
    app: { name: 'customer', version: '1.0.0', platform: 'android' },
    randomUUID: () => {
      uuid += 1;
      return `00000000-0000-4000-8000-${String(uuid).padStart(12, '0')}`;
    },
    fetch: server.fetch,
    WebSocket: server.WebSocket,
    random: () => 0.5,
    ...rest,
    clock,
    secretStorage: secrets,
    cacheStorage: cache,
    lifecycle,
  });
  return { client, server, clock, lifecycle, secrets, cache };
}

/** The HTTP status the fake server uses for an envelope status, for assertions. */
export function httpStatusOf(status: ApiErrorStatus): number {
  return HTTP_FOR[status];
}

export { statusForHttp };
