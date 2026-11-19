import type { PublicConfig } from './contract';
import { toApiError, type ApiError } from './errors';
import type { HttpPipeline } from './http';
import { STORAGE_KEYS, type Clock, type KeyValueStorage, type Lifecycle } from './platform';

export type { PublicConfig } from './contract';

export interface ConfigStore {
  /** The last known config: from this run, or from the device cache. Null only before the very first answer on this device. */
  get(): PublicConfig | null;
  /** Why the last `load()` failed, while `get()` is still null. Otherwise null. */
  error(): ApiError | null;
  subscribe(listener: () => void): () => void;
  load(): Promise<PublicConfig>;
}

/** The public OpenStreetMap tiles (V11): what a map shows before the first `/config` answer. */
export const DEFAULT_MAP_TILES: PublicConfig['map'] = {
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
};

/** `foreground` reloads the config when it is older than this (CLIENTS §8.1). */
const CONFIG_MAX_AGE_MS = 15 * 60_000;
/** While there is no config at all, a failed load is repeated this often. */
const CONFIG_RETRY_MS = 5_000;

interface CachedConfig {
  config: PublicConfig;
  savedAt: number;
}

export class ConfigStoreImpl implements ConfigStore {
  private config: PublicConfig | null = null;
  private lastError: ApiError | null = null;
  private loadedAt = 0;
  private inflight: Promise<PublicConfig> | null = null;
  private retryTimer: unknown = null;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: (() => void)[] = [];
  private cacheRead: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      http: HttpPipeline;
      cacheStorage: KeyValueStorage;
      clock: Clock;
      lifecycle: Lifecycle;
      setServerTime(serverTime: number): void;
    },
  ) {}

  get(): PublicConfig | null {
    return this.config;
  }

  error(): ApiError | null {
    return this.config ? null : this.lastError;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reads the cached copy, loads the fresh one, and keeps it current. Called by `client.start()`. */
  start(): void {
    if (this.disposers.length > 0) return;
    this.disposers.push(
      this.deps.lifecycle.subscribe((event) => {
        if (event === 'online' && !this.config) void this.load().catch(() => undefined);
        if (event === 'foreground' && this.deps.clock.now() - this.loadedAt > CONFIG_MAX_AGE_MS) {
          void this.load().catch(() => undefined);
        }
      }),
    );
    void this.readCache().then(() => this.load().catch(() => undefined));
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.retryTimer !== null) this.deps.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  load(): Promise<PublicConfig> {
    if (!this.inflight) {
      this.inflight = this.runLoad().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private readCache(): Promise<void> {
    if (!this.cacheRead) {
      this.cacheRead = (async () => {
        try {
          const raw = await this.deps.cacheStorage.getItem(STORAGE_KEYS.config);
          if (!raw || this.config) return;
          const cached = JSON.parse(raw) as Partial<CachedConfig>;
          if (cached.config) {
            this.config = cached.config;
            this.notify();
          }
        } catch {
          // A broken cache entry is replaced by the next answer.
        }
      })();
    }
    return this.cacheRead;
  }

  private async runLoad(): Promise<PublicConfig> {
    try {
      const config = await this.deps.http.request<PublicConfig>({ method: 'GET', path: '/config', auth: 'none' });
      this.config = config;
      this.lastError = null;
      this.loadedAt = this.deps.clock.now();
      this.deps.setServerTime(config.serverTime);
      const cached: CachedConfig = { config, savedAt: this.loadedAt };
      await this.deps.cacheStorage.setItem(STORAGE_KEYS.config, JSON.stringify(cached)).catch(() => undefined);
      this.notify();
      return config;
    } catch (error) {
      this.lastError = toApiError(error);
      if (!this.config) {
        this.notify();
        this.scheduleRetry();
      }
      throw this.lastError;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.disposers.length === 0) return;
    this.retryTimer = this.deps.clock.setTimeout(() => {
      this.retryTimer = null;
      if (!this.config) void this.load().catch(() => undefined);
    }, CONFIG_RETRY_MS);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
