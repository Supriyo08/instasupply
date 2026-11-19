import { COLLECTIONS, type StaffRole, type UserProfile } from '@instasupply/shared';
import { onIdTokenChanged, signOut as firebaseSignOut, type IdTokenResult, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { db } from '@/lib/firebase/app';
import { auth } from '@/lib/firebase/services';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  role: StaffRole | null;
  profile: UserProfile | null;
  /** Why the last session was rejected (e.g. a driver tried to sign in). */
  rejection: string | null;
}

interface AuthApi extends AuthState {
  isAdmin: boolean;
  displayName: string;
  signOut: () => Promise<void>;
  clearRejection: () => void;
}

const AuthContext = createContext<AuthApi | null>(null);

const REJECTIONS = {
  driver: 'This is a driver account. Drivers use the InstaSupply Driver app instead.',
  customer: 'This is a shopper account. Shop in the InstaSupply app; this console is for staff.',
  inactive: 'Your staff account is not active. Ask an administrator to restore access.',
  other: "This account doesn't have access to the dispatch console.",
  ended: 'Your session has ended. Please sign in again.',
};

/** Wait before retrying a token refresh that failed because the network was down. */
const TOKEN_RETRY_MS = 5_000;

function isNetworkError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'auth/network-request-failed';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    role: null,
    profile: null,
    rejection: null,
  });

  // Session + claims. Claims are the source of truth for access; rules enforce the same thing.
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;

    const applyUser = async (user: User | null) => {
      clearTimeout(retry);
      if (!user) {
        setState((current) => ({
          ...current,
          status: 'signed_out',
          user: null,
          role: null,
          profile: null,
        }));
        return;
      }
      let token: IdTokenResult;
      try {
        token = await user.getIdTokenResult();
      } catch (error) {
        if (auth.currentUser?.uid !== user.uid) return; // A newer session has taken over.
        if (isNetworkError(error)) {
          retry = setTimeout(() => void applyUser(user), TOKEN_RETRY_MS);
          return;
        }
        // The saved session can't be refreshed: the account was deleted or disabled, or the
        // emulators restarted without --persist. Drop it so the sign-in page shows.
        await firebaseSignOut(auth);
        setState({
          status: 'signed_out',
          user: null,
          role: null,
          profile: null,
          rejection: REJECTIONS.ended,
        });
        return;
      }
      const role = token.claims.role;
      const active = token.claims.active === true;
      if ((role === 'admin' || role === 'dispatcher') && active) {
        setState((current) => ({ ...current, status: 'signed_in', user, role, rejection: null }));
        return;
      }
      const rejection =
        role === 'driver'
          ? REJECTIONS.driver
          : role === 'customer'
            ? REJECTIONS.customer
            : role
              ? REJECTIONS.inactive
              : REJECTIONS.other;
      await firebaseSignOut(auth);
      setState({ status: 'signed_out', user: null, role: null, profile: null, rejection });
    };

    const unsubscribe = onIdTokenChanged(auth, applyUser);
    return () => {
      clearTimeout(retry);
      unsubscribe();
    };
  }, []);

  // Live profile (display name, preferences).
  const uid = state.user?.uid ?? null;
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, COLLECTIONS.users, uid), (snapshot) => {
      setState((current) => ({
        ...current,
        profile: snapshot.exists() ? ({ ...snapshot.data(), uid } as UserProfile) : null,
      }));
    });
  }, [uid]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const clearRejection = useCallback(() => setState((current) => ({ ...current, rejection: null })), []);

  const value = useMemo<AuthApi>(
    () => ({
      ...state,
      isAdmin: state.role === 'admin',
      displayName: state.profile?.displayName ?? state.user?.displayName ?? state.user?.email ?? 'Staff',
      signOut,
      clearRejection,
    }),
    [clearRejection, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}

/** For screens that only render when signed in. */
export function useSignedInUser(): { user: User; role: StaffRole; isAdmin: boolean; displayName: string } {
  const { user, role, isAdmin, displayName } = useAuth();
  if (!user || !role) throw new Error('useSignedInUser requires a signed-in staff member.');
  return { user, role, isAdmin, displayName };
}
