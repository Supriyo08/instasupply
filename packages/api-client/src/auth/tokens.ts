import type { AuthSessionResponse } from '../contract';
import { ApiError, toApiError } from '../errors';
import { STORAGE_KEYS, type Clock, type RefreshLock, type SecretStorage, type StoredSession } from '../platform';

/** A request refreshes first when the access token has less than this left (CLIENTS §1.5 rule 4). */
export const REFRESH_MARGIN_MS = 60_000;
/** Default pause after `resource-exhausted` on a refresh, when the server sends no `retryAfterMs`. */
const RATE_LIMIT_PAUSE_MS = 5_000;
/** Retry interval of the proactive refresh after a failure (no network): the socket stays open meanwhile. */
const KEEP_FRESH_RETRY_MS = 30_000;

export type RefreshEnd = { error: ApiError };

export interface TokenManagerDeps {
  secretStorage: SecretStorage;
  clock: Clock;
  refreshLock?: RefreshLock;
  /** `POST /auth/refresh` without a bearer. */
  postRefresh(refreshToken: string): Promise<AuthSessionResponse>;
  /** The refresh answered with a reason that ends the session. */
  onEnded(error: ApiError): void;
  /** A new session was stored and its access token is in use. */
  onRefreshed(response: AuthSessionResponse): void;
  onDebug?: (event: { type: string; [key: string]: unknown }) => void;
}

export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (value.v !== 1 || typeof value.uid !== 'string' || typeof value.refreshToken !== 'string') return null;
    return value as StoredSession;
  } catch {
    return null;
  }
}

/**
 * Access token in memory, refresh token in secret storage, one refresh in flight per runtime
 * (CLIENTS §1.5 token rules 1 to 8).
 */
export class TokenManager {
  private stored: StoredSession | null = null;
  private access: { token: string; deadline: number } | null = null;
  private inflight: Promise<string> | null = null;
  /** Bumped by `clear()`: a refresh that started for a session that has since ended must not revive it. */
  private generation = 0;
  private pausedUntil = 0;
  private pauseError: ApiError | null = null;
  /** The last raw value this runtime wrote, so its own write is not taken for another tab's. */
  private lastWritten: string | null = null;
  private keepFresh = false;
  private keepFreshTimer: unknown = null;
  private readonly tokenListeners = new Set<(token: string) => void>();

  constructor(private readonly deps: TokenManagerDeps) {}

  get session(): StoredSession | null {
    return this.stored;
  }

  hasSession(): boolean {
    return this.stored !== null;
  }

  /** True when `raw` is what this runtime itself wrote last (memory storage echoes to every listener). */
  isOwnWrite(raw: string | null): boolean {
    return raw !== null && raw === this.lastWritten;
  }

  async loadStored(): Promise<StoredSession | null> {
    this.stored = parseStoredSession(await this.deps.secretStorage.getItem(STORAGE_KEYS.session));
    return this.stored;
  }

  /** Another runtime rotated the token of the same account: remember it, keep our own access token. */
  adoptExternal(session: StoredSession): void {
    this.stored = session;
  }

  /** Stores a fresh session (login, register, set-password, refresh) before its access token is used. */
  async adopt(response: AuthSessionResponse, uid: string): Promise<void> {
    const session: StoredSession = {
      v: 1,
      uid,
      sessionId: response.sessionId,
      refreshToken: response.refreshToken,
      refreshTokenExpiresAt: response.refreshTokenExpiresAt,
    };
    const raw = JSON.stringify(session);
    this.lastWritten = raw;
    // Rule 3: written and awaited first, so a crash never leaves only a token the server already retired.
    await this.deps.secretStorage.setItem(STORAGE_KEYS.session, raw);
    this.stored = session;
    this.access = {
      token: response.accessToken,
      deadline: this.deps.clock.now() + response.accessTokenTtlSeconds * 1000,
    };
    this.pausedUntil = 0;
    this.scheduleKeepFresh();
    for (const listener of this.tokenListeners) listener(response.accessToken);
  }

  /** A valid access token, refreshing first when it has under 60 s left; null when signed out. */
  async accessToken(): Promise<string | null> {
    if (!this.stored) return null;
    if (this.access && this.access.deadline - this.deps.clock.now() > REFRESH_MARGIN_MS) return this.access.token;
    return this.refresh();
  }

  /** Like `accessToken`, but a missing session is an `unauthenticated` error (code outside React). */
  async requireAccessToken(): Promise<string> {
    const token = await this.accessToken();
    if (token === null) {
      throw new ApiError({
        status: 'unauthenticated',
        message: 'Sign in to continue.',
        details: { reason: 'token_invalid' },
        fromServer: false,
      });
    }
    return token;
  }

  /** The server said the access token is expired (401 or socket 4401): forget it. */
  markExpired(): void {
    this.access = null;
  }

  /**
   * A request was refused with `staleToken`. When a refresh already replaced it (ten requests met the
   * same expired token), that newer token is used; otherwise this refreshes (single flight).
   */
  replaceStale(staleToken: string): Promise<string> {
    if (this.inflight) return this.inflight;
    if (this.access && this.access.token !== staleToken) return Promise.resolve(this.access.token);
    this.access = null;
    return this.refresh();
  }

  /** Single flight: every caller during a refresh awaits the same promise (rule 2). */
  refresh(): Promise<string> {
    if (!this.inflight) {
      this.inflight = this.runRefresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  onToken(listener: (token: string) => void): () => void {
    this.tokenListeners.add(listener);
    return () => this.tokenListeners.delete(listener);
  }

  /** While true, refresh at `deadline − 60 s` without waiting for a request (rule 8, for the socket). */
  setKeepFresh(on: boolean): void {
    if (this.keepFresh === on) return;
    this.keepFresh = on;
    this.scheduleKeepFresh();
  }

  /** The session ended: forget everything, ignore any refresh still in flight. */
  clear(): void {
    this.generation += 1;
    this.stored = null;
    this.access = null;
    this.pausedUntil = 0;
    this.pauseError = null;
    this.lastWritten = null;
    this.cancelKeepFresh();
  }

  dispose(): void {
    this.cancelKeepFresh();
    this.keepFresh = false;
  }

  private async runRefresh(): Promise<string> {
    const { clock } = this.deps;
    if (clock.now() < this.pausedUntil && this.pauseError) throw this.pauseError;
    const generation = this.generation;
    const task = async (): Promise<{ response: AuthSessionResponse; uid: string }> => {
      // Rule 5: always the token found in storage, never one remembered in memory; another tab or
      // runtime may have rotated it a moment ago.
      const raw = await this.deps.secretStorage.getItem(STORAGE_KEYS.session);
      const current = parseStoredSession(raw);
      if (!current || (this.stored && current.uid !== this.stored.uid)) {
        throw new ApiError({
          status: 'unauthenticated',
          message: 'The session ended on this device.',
          details: { reason: 'session_revoked', local: true },
          fromServer: false,
        });
      }
      this.debug({ type: 'auth.refresh.start' });
      const response = await this.deps.postRefresh(current.refreshToken);
      if (generation !== this.generation) {
        throw new ApiError({ status: 'cancelled', message: 'The session ended during the refresh.' });
      }
      await this.adopt(response, response.me?.account.uid ?? current.uid);
      return { response, uid: current.uid };
    };
    try {
      const { response } = this.deps.refreshLock ? await this.deps.refreshLock.run(task) : await task();
      this.debug({ type: 'auth.refresh.ok' });
      this.deps.onRefreshed(response);
      return response.accessToken;
    } catch (error) {
      const e = toApiError(error);
      this.debug({ type: 'auth.refresh.error', status: e.status, reason: e.authReason });
      if (generation !== this.generation) throw e;
      if (e.status === 'resource-exhausted') {
        const wait = typeof e.details.retryAfterMs === 'number' ? e.details.retryAfterMs : RATE_LIMIT_PAUSE_MS;
        this.pausedUntil = clock.now() + wait;
        this.pauseError = e;
      } else if (endsSession(e)) {
        this.deps.onEnded(e);
      }
      // No answer, a timeout or a 5xx: the session stays and the caller fails with that error (rule 6).
      throw e;
    }
  }

  private scheduleKeepFresh(): void {
    this.cancelKeepFresh();
    if (!this.keepFresh || !this.stored) return;
    const due = this.access ? this.access.deadline - REFRESH_MARGIN_MS - this.deps.clock.now() : 0;
    this.keepFreshTimer = this.deps.clock.setTimeout(
      () => {
        this.keepFreshTimer = null;
        this.refresh().catch(() => {
          // Offline or the server is down: try again later; the socket survives the 30 s server grace.
          if (this.keepFresh && this.stored && !this.keepFreshTimer) {
            this.keepFreshTimer = this.deps.clock.setTimeout(() => {
              this.keepFreshTimer = null;
              this.scheduleKeepFresh();
            }, KEEP_FRESH_RETRY_MS);
          }
        });
      },
      Math.max(0, due),
    );
  }

  private cancelKeepFresh(): void {
    if (this.keepFreshTimer !== null) {
      this.deps.clock.clearTimeout(this.keepFreshTimer);
      this.keepFreshTimer = null;
    }
  }

  private debug(event: { type: string; [key: string]: unknown }): void {
    this.deps.onDebug?.(event);
  }
}

/** Refresh answers that end the session (CLIENTS §1.5 rule 6). */
export function endsSession(error: ApiError): boolean {
  if (error.status === 'permission-denied') return error.authReason === 'account_suspended';
  return error.status === 'unauthenticated';
}
