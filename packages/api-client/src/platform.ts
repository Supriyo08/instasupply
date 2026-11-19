/**
 * Everything that differs by platform is injected through these interfaces (CLIENTS §1.4), so the core
 * runs unchanged in a browser, in React Native and under node:test.
 */

/** What `secretStorage['instasupply.session.v1']` holds, as JSON. */
export interface StoredSession {
  v: 1;
  uid: string;
  sessionId: string;
  refreshToken: string;
  /** Epoch ms; informational, the server decides. */
  refreshTokenExpiresAt: number;
}

/** Non-secret persistence: cached profile and config, installation id. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Where secrets live: the stored session (JSON of StoredSession) and the logout queue.
 * Native: Keychain / Keystore. Web: localStorage.
 */
export interface SecretStorage extends KeyValueStorage {
  /** Web only: another tab wrote or removed `key`. */
  onExternalChange?(listener: (key: string, value: string | null) => void): () => void;
}

/** Serializes refreshes across browser tabs. Not needed on native (one runtime). */
export interface RefreshLock {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export type LifecycleEvent = 'foreground' | 'background' | 'online' | 'offline';

export interface Lifecycle {
  /** Native: AppState is 'active'. Web: always true (a hidden console tab must keep alerting). */
  isForeground(): boolean;
  /** False only when the platform is sure there is no network. */
  isOnline(): boolean;
  subscribe(listener: (event: LifecycleEvent) => void): () => void;
}

export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = new (url: string) => WebSocketLike;

/** What `createWebPlatform()` and `createNativePlatform()` return: spread it into `createApiClient`. */
export interface PlatformBindings {
  secretStorage: SecretStorage;
  cacheStorage: KeyValueStorage;
  lifecycle: Lifecycle;
  randomUUID: () => string;
  refreshLock?: RefreshLock;
}

/** The real clock. Timers are wrapped so `this` is never lost on runtimes that care (browsers). */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** Storage keys owned by the package (CLIENTS §1.4). Apps keep their own keys. */
export const STORAGE_KEYS = {
  session: 'instasupply.session.v1',
  logoutQueue: 'instasupply.logout-queue.v1',
  me: 'instasupply.me.v1',
  config: 'instasupply.config.v1',
  installationId: 'instasupply.installationId',
} as const;
