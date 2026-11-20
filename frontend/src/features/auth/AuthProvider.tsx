/**
 * The console's session (docs/CLIENTS.md §2.7): a pure function of the api-client session core plus
 * one local flag, the rejection message of an account that may not use the console.
 */
import type { ApiError, SessionEndReason, SessionUser, WithId } from '@instasupply/api-client';
import { useSessionCore } from '@instasupply/api-client/react';
import type { Store, StoreRole, UserProfile } from '@instasupply/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/lib/api';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';
export type ConsoleRole = 'admin' | 'dispatcher' | 'supplier';

export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  role: ConsoleRole | null;
  profile: UserProfile | null;
  /** Suppliers: from `profile.storeId`, `profile.storeRole` and the core's `store`. */
  storeId: string | null;
  storeRole: StoreRole | null;
  store: WithId<Store> | null;
  /** Why the last session ended or was refused, for the sign-in page. */
  rejection: string | null;
  /** Stored tokens exist but the account cannot be loaded (offline, server down). Shown with `retry`. */
  problem: ApiError | null;
}

export interface AuthApi extends AuthState {
  isAdmin: boolean;
  isStaff: boolean;
  isSupplier: boolean;
  /** Supplier owners also see Payouts, Insights and Team (MARKETPLACE §8). */
  isStoreOwner: boolean;
  displayName: string;
  signOut: () => Promise<void>;
  clearRejection: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export const REJECTIONS = {
  ended: 'Your session has ended. Please sign in again.',
  suspended: 'Your account is not active. Ask an administrator to restore access.',
  driver: 'This is a driver account. Drivers use the InstaSupply Driver app.',
  customer: 'This is a customer account. Order in the InstaSupply app.',
  other: "This account doesn't have access to the console.",
} as const;

function rejectionForEnd(reason: SessionEndReason | null): string | null {
  if (reason === 'expired' || reason === 'revoked') return REJECTIONS.ended;
  if (reason === 'suspended') return REJECTIONS.suspended;
  return null;
}

/** Null when the profile may use the console; otherwise the message for the sign-in page (§2.7 row 3). */
function refusalFor(profile: UserProfile | null): string | null {
  if (!profile) return REJECTIONS.other;
  if (profile.role === 'driver') return REJECTIONS.driver;
  if (profile.role === 'customer') return REJECTIONS.customer;
  if (profile.status === 'suspended') return REJECTIONS.suspended;
  if (profile.status !== 'active') return REJECTIONS.other;
  if (profile.role === 'supplier' && !profile.storeId) return REJECTIONS.other;
  return null;
}

const SIGNED_OUT: Omit<AuthState, 'rejection' | 'problem'> = {
  status: 'signed_out',
  user: null,
  role: null,
  profile: null,
  storeId: null,
  storeRole: null,
  store: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const core = useSessionCore();
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusedUid = useRef<string | null>(null);

  const refusalNow = core.status === 'signed_in' ? refusalFor(core.profile) : null;
  const uid = core.user?.uid ?? null;

  // Row 3: an account that may not use the console is signed out at once, and the reason is kept.
  useEffect(() => {
    if (!refusalNow || !uid || refusedUid.current === uid) return;
    refusedUid.current = uid;
    setRefusal(refusalNow);
    void api.session.signOut();
  }, [refusalNow, uid]);

  // Once signed out, the same account signing in again is checked again.
  useEffect(() => {
    if (core.status === 'signed_out') refusedUid.current = null;
  }, [core.status]);

  // Another tab signed in as someone else: start over with that account (§2.6).
  useEffect(() => {
    if (core.endReason === 'replaced') window.location.reload();
  }, [core.endReason]);

  const state = useMemo<AuthState>(() => {
    if (core.status === 'restoring') {
      return { ...SIGNED_OUT, status: 'loading', rejection: null, problem: core.problem };
    }
    if (core.status === 'signed_out' || !core.user || !core.profile || refusalNow) {
      return {
        ...SIGNED_OUT,
        rejection: refusalNow ?? refusal ?? rejectionForEnd(core.endReason),
        problem: null,
      };
    }
    const profile = core.profile;
    const role = profile.role as ConsoleRole;
    const isSupplier = role === 'supplier';
    return {
      status: 'signed_in',
      user: core.user,
      role,
      profile,
      storeId: isSupplier ? (profile.storeId ?? null) : null,
      storeRole: isSupplier ? (profile.storeRole ?? null) : null,
      store: isSupplier ? core.store : null,
      rejection: null,
      problem: null,
    };
  }, [core, refusal, refusalNow]);

  const signOut = useCallback(async () => {
    setRefusal(null);
    refusedUid.current = null;
    await api.session.signOut();
  }, []);

  const clearRejection = useCallback(() => {
    setRefusal(null);
    refusedUid.current = null;
    api.session.acknowledgeEnd();
  }, []);

  const retry = useCallback(() => api.session.retry(), []);

  const value = useMemo<AuthApi>(
    () => ({
      ...state,
      isAdmin: state.role === 'admin',
      isStaff: state.role === 'admin' || state.role === 'dispatcher',
      isSupplier: state.role === 'supplier',
      isStoreOwner: state.role === 'supplier' && state.storeRole === 'owner',
      displayName: state.profile?.displayName || state.user?.displayName || state.user?.email || 'Staff',
      signOut,
      clearRejection,
      retry,
    }),
    [clearRejection, retry, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}

export interface SignedInStaff {
  user: SessionUser;
  role: 'admin' | 'dispatcher';
  profile: UserProfile;
  isAdmin: boolean;
  displayName: string;
}

/** For ops screens, which render only under `RequireStaff`. */
export function useSignedInUser(): SignedInStaff {
  const { user, role, profile, isAdmin, displayName } = useAuth();
  if (!user || !profile || (role !== 'admin' && role !== 'dispatcher')) {
    throw new Error('useSignedInUser requires a signed-in staff member.');
  }
  return { user, role, profile, isAdmin, displayName };
}

export interface SignedInSupplier {
  user: SessionUser;
  profile: UserProfile;
  storeId: string;
  storeRole: StoreRole;
  /** The store's public row from `/me`; use `queries.store(storeId)` for live data. */
  store: WithId<Store> | null;
  isOwner: boolean;
  displayName: string;
}

/** For portal screens, which render only under `RequireSupplier`. */
export function useSupplier(): SignedInSupplier {
  const { user, profile, role, storeId, storeRole, store, displayName } = useAuth();
  if (!user || !profile || role !== 'supplier' || !storeId) {
    throw new Error('useSupplier requires a signed-in supplier with a store.');
  }
  const resolvedRole: StoreRole = storeRole ?? 'staff';
  return {
    user,
    profile,
    storeId,
    storeRole: resolvedRole,
    store,
    isOwner: resolvedRole === 'owner',
    displayName,
  };
}
