/**
 * The driver app's session (docs/CLIENTS.md §2.3): a pure function of the api-client session core,
 * the public config and nothing else. Approval, suspension, phone verification and vehicle reviews
 * arrive on the `user:{uid}` topic, which makes the core refetch `/me`, so the status moves by itself.
 */
import type { UserProfile } from '@instasupply/shared';
import type { PublicConfig, SessionEndReason, SessionSnapshot, SessionUser } from '@instasupply/api-client';
import { useConfig, useSessionCore } from '@instasupply/api-client/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { cleanUpLocationAfterSessionEnd } from '@/features/location/session-cleanup';
import { api, describeError } from '@/lib/api';

export type SessionStatus =
  | 'loading'
  | 'signed_out'
  | 'staff_account'
  | 'shopper_account'
  | 'supplier_account'
  | 'needs_profile'
  | 'needs_phone'
  | 'pending_approval'
  | 'suspended'
  | 'ready';

export interface Session {
  status: SessionStatus;
  user: SessionUser | null;
  profile: UserProfile | null;
  /** Shown over the splash with "Try again" and a sign-out link: the account or the config cannot be loaded. */
  problem: string | null;
  retry: () => void;
  /** Why the last session ended; the sign-in screen explains it (§2.4). Cleared by the next sign-in. */
  endReason: SessionEndReason | null;
}

/** Statuses that belong to a driver account (push registration runs for these, code review R59). */
export const DRIVER_STATUSES: readonly SessionStatus[] = ['needs_phone', 'pending_approval', 'ready'];

/** The table of docs/CLIENTS.md §2.3, in order. */
export function deriveStatus(core: SessionSnapshot, config: PublicConfig | null): SessionStatus {
  if (core.status === 'restoring' || !config) return 'loading';
  const { user, profile } = core;
  if (!user) return core.endReason === 'suspended' ? 'suspended' : 'signed_out';
  if (!profile) return 'needs_profile';
  if (profile.role === 'admin' || profile.role === 'dispatcher') return 'staff_account';
  if (profile.role === 'customer') return 'shopper_account';
  if (profile.role === 'supplier') return 'supplier_account';
  if (profile.status === 'suspended') return 'suspended';
  if (requiresPhone(config) && !profile.phoneVerified) return 'needs_phone';
  if (profile.status === 'pending') return 'pending_approval';
  return 'ready';
}

/**
 * With `phoneVerification: 'required'` the phone step is mandatory, except in production with the
 * outbox SMS driver, where no code can be delivered: then the phone screens behave as with 'off' (§2.2).
 */
export function requiresPhone(config: PublicConfig): boolean {
  if (config.environment === 'production' && config.smsDriver === 'outbox') return false;
  return config.phoneVerification === 'required';
}

/** Endings that the sign-in screen explains (§2.4). */
export function endReasonMessage(reason: SessionEndReason | null): string | null {
  switch (reason) {
    case 'expired':
    case 'revoked':
    case 'replaced':
      return 'Your session has ended. Please sign in again.';
    default:
      return null;
  }
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const core = useSessionCore();
  const config = useConfig();

  const status = deriveStatus(core, config);
  const configError = config ? null : api.config.error();
  const problem = core.problem
    ? describeError(core.problem)
    : configError
      ? describeError(configError, "Can't reach the server. Check your connection and try again.")
      : null;

  const retry = useCallback(() => {
    api.session.retry();
    void api.config.load().catch(() => undefined);
  }, []);

  // Whenever there is no signed-in user any more (sign-out, expiry, revocation, suspension), stop the
  // background location task and forget the online switch, so nothing keeps publishing for an old
  // account and the next driver on this phone does not go online by themselves (code review R67).
  const hadUser = useRef<boolean | null>(null);
  const hasUser = core.status === 'signed_in';
  useEffect(() => {
    if (core.status === 'restoring') return;
    if (!hasUser && hadUser.current !== false) void cleanUpLocationAfterSessionEnd();
    hadUser.current = hasUser;
  }, [core.status, hasUser]);

  const value = useMemo<Session>(
    () => ({ status, user: core.user, profile: core.profile, problem, retry, endReason: core.endReason }),
    [status, core.user, core.profile, problem, retry, core.endReason],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

/** For screens inside the signed-in area (`(app)`), where a user and a driver profile are guaranteed. */
export function useDriver(): { user: SessionUser; profile: UserProfile } {
  const { user, profile } = useSession();
  if (!user || !profile) throw new Error('useDriver called outside the signed-in area.');
  return { user, profile };
}
