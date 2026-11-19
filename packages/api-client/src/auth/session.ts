import type { Role, Store, UserProfile } from '@instasupply/shared';

import type {
  AuthSessionResponse,
  ClientApp,
  InviteInfo,
  MeResponse,
  ProfilePatch,
  WithId,
} from '../contract';
import { ApiError, toApiError } from '../errors';
import type { HttpPipeline } from '../http';
import type { LiveClient } from '../live/live-client';
import { STORAGE_KEYS, type Clock, type KeyValueStorage, type Lifecycle, type SecretStorage } from '../platform';
import { topics } from '../topics';

import { LogoutQueue } from './logout-queue';
import { parseStoredSession, type TokenManager } from './tokens';

/** What screens used from the old auth user: uid, email, displayName. */
export interface SessionUser {
  uid: string;
  email: string;
  /** The profile's name, or the name given at registration while there is no profile yet. */
  displayName: string;
}

export type CoreStatus = 'restoring' | 'signed_out' | 'signed_in';

export type SessionEndReason =
  | 'signed_out' // the user chose to
  | 'expired' // the refresh token expired or is unknown
  | 'revoked' // signed out elsewhere, by staff, or reuse was detected
  | 'suspended' // the account was suspended
  | 'replaced'; // web: another tab signed in as someone else

export interface SessionSnapshot {
  status: CoreStatus;
  user: SessionUser | null;
  profile: UserProfile | null;
  store: WithId<Store> | null;
  /** True while user and profile come from the device cache and the server has not confirmed them in this run. */
  stale: boolean;
  /** Why the last session ended. Cleared by `acknowledgeEnd()` and by the next sign-in. */
  endReason: SessionEndReason | null;
  /** Tokens exist but the account cannot be loaded and there is no cached copy. Show it with `retry`. */
  problem: ApiError | null;
}

export interface SessionCore {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves once stored tokens were read (and, with a cached profile, at once). Starts the restore if needed. */
  whenRestored(): Promise<SessionSnapshot>;

  signIn(input: { email: string; password: string }): Promise<SessionSnapshot>;
  /** Creates an account without a role. The apps follow it with `registerCustomer` or `registerDriver`. */
  register(input: { email: string; password: string; displayName: string }): Promise<SessionSnapshot>;
  /** Never rejects: when the server cannot be reached, the sign-out is queued and the device is cleaned anyway. */
  signOut(options?: { everywhere?: boolean }): Promise<void>;

  /** GET /me. Call after registerCustomer, registerDriver, verifyPhoneOtp and updateDriverVehicle. */
  refreshProfile(): Promise<SessionSnapshot>;
  updateProfile(patch: ProfilePatch): Promise<SessionSnapshot>;

  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  inspectInvite(token: string): Promise<{ email: string; displayName: string; role: Role; expiresAt: number }>;
  setUpPassword(input: { token: string; password: string }): Promise<SessionSnapshot>;

  acknowledgeEnd(): void;
  /** Try again after `problem`. */
  retry(): void;
  /** For code outside React (the background location task): a valid access token, or an ApiError. */
  accessToken(): Promise<string>;
}

/** Retry interval while tokens exist but neither the server nor a cached profile can be reached (§2.1). */
const PROBLEM_RETRY_MS = 5_000;
/** `foreground` reloads the profile when it is older than this (CLIENTS §1.5). */
const PROFILE_MAX_AGE_MS = 60_000;
/** `POST /auth/logout` gets this long before it is queued (CLIENTS §2.5). */
const LOGOUT_TIMEOUT_MS = 3_000;

interface CachedMe {
  me: MeResponse;
  savedAt: number;
}

export interface SessionCoreDeps {
  http: HttpPipeline;
  tokens: TokenManager;
  secretStorage: SecretStorage;
  cacheStorage: KeyValueStorage;
  clock: Clock;
  lifecycle: Lifecycle;
  app: ClientApp;
  installationId(): Promise<string>;
  setServerTime(serverTime: number): void;
  /** The query cache drops every private entry (the uid changed or the session ended). */
  clearPrivate(): void;
  onDebug?: (event: { type: string; [key: string]: unknown }) => void;
}

const SIGNED_OUT: SessionSnapshot = {
  status: 'signed_out',
  user: null,
  profile: null,
  store: null,
  stale: false,
  endReason: null,
  problem: null,
};

/** Maps a session-ending answer to the reason screens show (CLIENTS §2.4). */
export function endReasonFor(error: ApiError): SessionEndReason {
  if (error.authReason === 'account_suspended') return 'suspended';
  if (error.authReason === 'session_revoked' || error.authReason === 'refresh_reused') return 'revoked';
  return 'expired';
}

export class SessionCoreImpl implements SessionCore {
  private snapshot: SessionSnapshot = { ...SIGNED_OUT, status: 'restoring' };
  private readonly listeners = new Set<() => void>();
  private restorePromise: Promise<SessionSnapshot> | null = null;
  private readonly logoutQueue: LogoutQueue;
  /** Local time of the last profile confirmed by the server. */
  private profileAt = 0;
  /** Name given at registration, shown until a profile exists. */
  private registeredName: string | null = null;
  private problemTimer: unknown = null;
  private live: LiveClient | null = null;
  private userTopicOff: (() => void) | null = null;
  private userTopicUid: string | null = null;
  private readonly disposers: (() => void)[] = [];
  private started = false;
  private markTokensRead: () => void = () => undefined;
  private tokensRead: Promise<void> = new Promise((resolve) => {
    this.markTokensRead = resolve;
  });

  constructor(private readonly deps: SessionCoreDeps) {
    this.logoutQueue = new LogoutQueue(deps.secretStorage, async (refreshToken) => {
      await deps.http.request({
        method: 'POST',
        path: '/auth/logout',
        body: { refreshToken },
        auth: 'none',
        timeoutMs: LOGOUT_TIMEOUT_MS,
      });
    });
  }

  /** Wired by `createApiClient` once the live client exists (they need each other). */
  attachLive(live: LiveClient): void {
    this.live = live;
    this.syncUserTopic();
  }

  /** Lifecycle and cross-tab listeners. Called by `client.start()`. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.disposers.push(this.deps.lifecycle.subscribe((event) => this.onLifecycle(event)));
    const off = this.deps.secretStorage.onExternalChange?.((key, value) => this.onExternalChange(key, value));
    if (off) this.disposers.push(off);
    void this.whenRestored();
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.started = false;
    this.cancelProblemRetry();
    this.userTopicOff?.();
    this.userTopicOff = null;
    this.userTopicUid = null;
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  whenRestored(): Promise<SessionSnapshot> {
    if (!this.restorePromise) this.restorePromise = this.restore();
    return this.restorePromise;
  }

  /**
   * Resolves once the stored session was read. The request pipeline waits for this, not for the whole
   * restore, because the restore itself sends requests (refresh, GET /me).
   */
  whenTokensRead(): Promise<void> {
    void this.whenRestored();
    return this.tokensRead;
  }

  // ---------- sign-in family ----------

  async signIn(input: { email: string; password: string }): Promise<SessionSnapshot> {
    await this.whenRestored();
    try {
      const response = await this.deps.http.request<AuthSessionResponse>({
        method: 'POST',
        path: '/auth/login',
        body: {
          email: input.email,
          password: input.password,
          installationId: await this.deps.installationId(),
          app: this.deps.app,
        },
        auth: 'none',
      });
      return await this.adoptResponse(response);
    } catch (error) {
      const e = toApiError(error);
      if (e.authReason === 'account_suspended') this.set({ endReason: 'suspended' });
      throw e;
    }
  }

  async register(input: { email: string; password: string; displayName: string }): Promise<SessionSnapshot> {
    await this.whenRestored();
    const response = await this.deps.http.request<AuthSessionResponse>({
      method: 'POST',
      path: '/auth/register',
      body: {
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        installationId: await this.deps.installationId(),
        app: this.deps.app,
      },
      auth: 'none',
    });
    this.registeredName = input.displayName;
    return this.adoptResponse(response);
  }

  async setUpPassword(input: { token: string; password: string }): Promise<SessionSnapshot> {
    await this.whenRestored();
    const response = await this.deps.http.request<AuthSessionResponse>({
      method: 'POST',
      path: '/auth/password/setup',
      body: {
        token: input.token,
        password: input.password,
        installationId: await this.deps.installationId(),
        app: this.deps.app,
      },
      auth: 'none',
    });
    return this.adoptResponse(response);
  }

  async signOut(options?: { everywhere?: boolean }): Promise<void> {
    await this.whenRestored().catch(() => undefined);
    const stored = this.deps.tokens.session;
    if (stored) {
      let done = false;
      if (options?.everywhere) {
        try {
          await this.deps.http.request({ method: 'POST', path: '/auth/logout-all', timeoutMs: LOGOUT_TIMEOUT_MS });
          done = true;
        } catch {
          // Fall back to ending this device's session; the user can repeat "everywhere" later.
        }
      }
      if (!done) {
        try {
          await this.deps.http.request({
            method: 'POST',
            path: '/auth/logout',
            body: { refreshToken: stored.refreshToken },
            auth: 'none',
            timeoutMs: LOGOUT_TIMEOUT_MS,
          });
        } catch (error) {
          if (toApiError(error).isNetwork) {
            await this.logoutQueue.push(stored.refreshToken).catch(() => undefined);
          }
        }
      }
    }
    await this.endSession('signed_out', { external: false });
  }

  // ---------- profile ----------

  async refreshProfile(): Promise<SessionSnapshot> {
    await this.whenRestored();
    return this.loadMe();
  }

  /** GET /me without waiting for the restore (the restore itself calls it). */
  private async loadMe(): Promise<SessionSnapshot> {
    const me = await this.deps.http.request<MeResponse>({ method: 'GET', path: '/me' });
    await this.applyMe(me);
    return this.snapshot;
  }

  async updateProfile(patch: ProfilePatch): Promise<SessionSnapshot> {
    await this.whenRestored();
    const me = await this.deps.http.request<MeResponse>({ method: 'PATCH', path: '/me', body: patch });
    await this.applyMe(me);
    return this.snapshot;
  }

  // ---------- passwords and invites ----------

  async requestPasswordReset(email: string): Promise<void> {
    await this.deps.http.request({ method: 'POST', path: '/auth/password/forgot', body: { email }, auth: 'none' });
  }

  async resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void> {
    await this.deps.http.request({ method: 'POST', path: '/auth/password/reset', body: input, auth: 'none' });
  }

  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    await this.deps.http.request({ method: 'POST', path: '/auth/password/change', body: input });
  }

  inspectInvite(token: string): Promise<InviteInfo> {
    return this.deps.http.request<InviteInfo>({
      method: 'POST',
      path: '/auth/invites/inspect',
      body: { token },
      auth: 'none',
    });
  }

  // ---------- misc ----------

  acknowledgeEnd(): void {
    if (this.snapshot.endReason !== null) this.set({ endReason: null });
  }

  retry(): void {
    if (this.snapshot.status === 'restoring' && this.snapshot.problem) {
      this.cancelProblemRetry();
      void this.restoreFromServer();
    } else if (this.snapshot.status === 'signed_in' && this.snapshot.stale) {
      void this.confirmInBackground();
    }
  }

  async accessToken(): Promise<string> {
    await this.whenRestored();
    return this.deps.tokens.requireAccessToken();
  }

  // ---------- hooks for the token manager and the pipeline ----------

  /** A refresh succeeded: its `me` updates the snapshot (or GET /me fills in when it was left out). */
  onRefreshed(response: AuthSessionResponse): void {
    if (response.me) {
      void this.applyMe(response.me);
    } else {
      this.loadMe().catch(() => undefined);
    }
  }

  /** The server ended the session (refresh answer, request answer, socket 4403 followed by /me). */
  onAuthEnded(error: ApiError): void {
    if (error.details.local === true) {
      // Our own check found the stored session gone or replaced by another tab.
      void this.deps.secretStorage.getItem(STORAGE_KEYS.session).then((raw) => {
        const other = parseStoredSession(raw);
        void this.endSession(other ? 'replaced' : 'signed_out', { external: true });
      });
      return;
    }
    if (this.snapshot.status === 'signed_out' && !this.deps.tokens.hasSession()) return;
    void this.endSession(endReasonFor(error), { external: false });
  }

  // ---------- internals ----------

  private async restore(): Promise<SessionSnapshot> {
    void this.logoutQueue.flush().catch(() => undefined);
    let stored = null;
    try {
      stored = await this.deps.tokens.loadStored();
    } catch {
      stored = null;
    }
    this.markTokensRead();
    if (!stored) {
      this.set({ ...SIGNED_OUT, endReason: this.snapshot.endReason });
      return this.snapshot;
    }
    const cached = await this.readCachedMe(stored.uid);
    if (cached) {
      this.adoptMe(cached.me, { stale: true });
      // The access token is gone after a restart; refreshing also confirms the profile (§2.1).
      void this.confirmInBackground();
      return this.snapshot;
    }
    return this.restoreFromServer();
  }

  private async restoreFromServer(): Promise<SessionSnapshot> {
    try {
      await this.deps.tokens.refresh();
      // `onRefreshed` applies `me`; when the answer had none, wait for GET /me.
      if (this.snapshot.status !== 'signed_in') await this.loadMe();
    } catch (error) {
      const e = toApiError(error);
      if (this.deps.tokens.hasSession() && this.snapshot.status === 'restoring') {
        this.set({ problem: e });
        this.scheduleProblemRetry();
      }
    }
    return this.snapshot;
  }

  private async confirmInBackground(): Promise<void> {
    try {
      await this.deps.tokens.refresh();
    } catch {
      // Offline: the cached profile stays on screen; the next request, `online` or `foreground` retries.
    }
  }

  private async adoptResponse(response: AuthSessionResponse): Promise<SessionSnapshot> {
    const uid = response.me?.account.uid ?? this.deps.tokens.session?.uid;
    if (!uid) {
      // Without `me` the uid is unknown until GET /me answers; store under a placeholder first.
      await this.deps.tokens.adopt(response, '');
      const me = await this.deps.http.request<MeResponse>({ method: 'GET', path: '/me' });
      await this.deps.tokens.adopt(response, me.account.uid);
      await this.applyMe(me, { endReason: null });
      return this.snapshot;
    }
    await this.deps.tokens.adopt(response, uid);
    if (response.me) await this.applyMe(response.me, { endReason: null });
    else await this.applyMe(await this.deps.http.request<MeResponse>({ method: 'GET', path: '/me' }), { endReason: null });
    return this.snapshot;
  }

  private async applyMe(me: MeResponse, extra?: Partial<SessionSnapshot>): Promise<void> {
    if (!this.deps.tokens.hasSession()) return; // a late answer after the session ended
    this.deps.setServerTime(me.serverTime);
    this.profileAt = this.deps.clock.now();
    this.adoptMe(me, { stale: false, ...extra });
    const cached: CachedMe = { me, savedAt: this.deps.clock.now() };
    await this.deps.cacheStorage.setItem(STORAGE_KEYS.me, JSON.stringify(cached)).catch(() => undefined);
  }

  private adoptMe(me: MeResponse, extra: Partial<SessionSnapshot>): void {
    const previousUid = this.snapshot.user?.uid ?? null;
    const user: SessionUser = {
      uid: me.account.uid,
      email: me.account.email,
      displayName: me.profile?.displayName ?? this.registeredName ?? '',
    };
    if (previousUid !== null && previousUid !== user.uid) this.deps.clearPrivate();
    this.cancelProblemRetry();
    this.set({
      status: 'signed_in',
      user,
      profile: me.profile,
      store: me.store,
      problem: null,
      ...extra,
    });
    this.syncUserTopic();
  }

  private async readCachedMe(uid: string): Promise<CachedMe | null> {
    try {
      const raw = await this.deps.cacheStorage.getItem(STORAGE_KEYS.me);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<CachedMe>;
      if (!value.me || value.me.account?.uid !== uid) return null;
      this.profileAt = typeof value.savedAt === 'number' ? value.savedAt : 0;
      return value as CachedMe;
    } catch {
      return null;
    }
  }

  /**
   * Ends the session in the order of CLIENTS §2.4: token manager, storage, private queries, socket
   * identity (through the snapshot), subscribers. `external`: another tab changed the stored session, so
   * this tab must not remove what that tab wrote.
   */
  private async endSession(reason: SessionEndReason, options: { external: boolean }): Promise<void> {
    const hadSession = this.deps.tokens.hasSession() || this.snapshot.status !== 'signed_out';
    this.deps.tokens.clear();
    this.cancelProblemRetry();
    // Removal starts first; the snapshot changes in the same tick so no caller sees a half-ended session.
    const removals = options.external
      ? []
      : [
          this.deps.secretStorage.removeItem(STORAGE_KEYS.session).catch(() => undefined),
          this.deps.cacheStorage.removeItem(STORAGE_KEYS.me).catch(() => undefined),
        ];
    this.registeredName = null;
    if (hadSession) this.deps.clearPrivate();
    this.set({ ...SIGNED_OUT, endReason: reason });
    this.syncUserTopic();
    this.deps.onDebug?.({ type: 'session.ended', reason });
    await Promise.all(removals);
  }

  private onExternalChange(key: string, value: string | null): void {
    if (key !== STORAGE_KEYS.session || this.deps.tokens.isOwnWrite(value)) return;
    const mine = this.snapshot.user?.uid ?? this.deps.tokens.session?.uid ?? null;
    const next = parseStoredSession(value);
    if (!next) {
      if (mine !== null || this.deps.tokens.hasSession()) void this.endSession('signed_out', { external: true });
      return;
    }
    if (mine === null) {
      // Another tab signed in while this one was signed out: follow it.
      this.restorePromise = null;
      this.restorePromise = this.restore();
      return;
    }
    if (next.uid !== mine) {
      void this.endSession('replaced', { external: true });
      return;
    }
    // Same account, rotated by the other tab: only the refresh token changed; our access token stays valid.
    this.deps.tokens.adoptExternal(next);
  }

  private onLifecycle(event: 'foreground' | 'background' | 'online' | 'offline'): void {
    if (event === 'online') void this.logoutQueue.flush().catch(() => undefined);
    if (event !== 'online' && event !== 'foreground') return;
    const { status, problem, stale } = this.snapshot;
    if (status === 'restoring' && problem) {
      this.retry();
    } else if (status === 'signed_in' && stale) {
      void this.confirmInBackground();
    } else if (
      event === 'foreground' &&
      status === 'signed_in' &&
      this.deps.clock.now() - this.profileAt > PROFILE_MAX_AGE_MS
    ) {
      this.refreshProfile().catch(() => undefined);
    }
  }

  /** `user:{uid}` carries approvals, suspensions, role and vehicle changes: any event reloads /me. */
  private syncUserTopic(): void {
    const uid = this.snapshot.status === 'signed_in' ? (this.snapshot.user?.uid ?? null) : null;
    if (uid === this.userTopicUid && (uid === null || this.userTopicOff)) return;
    this.userTopicOff?.();
    this.userTopicOff = null;
    this.userTopicUid = uid;
    if (!uid || !this.live) return;
    this.userTopicOff = this.live.subscribe(topics.user(uid), () => {
      this.refreshProfile().catch(() => undefined);
    });
  }

  private scheduleProblemRetry(): void {
    this.cancelProblemRetry();
    this.problemTimer = this.deps.clock.setTimeout(() => {
      this.problemTimer = null;
      if (this.snapshot.status === 'restoring' && this.snapshot.problem) void this.restoreFromServer();
    }, PROBLEM_RETRY_MS);
  }

  private cancelProblemRetry(): void {
    if (this.problemTimer !== null) {
      this.deps.clock.clearTimeout(this.problemTimer);
      this.problemTimer = null;
    }
  }

  private set(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
