import type { AuthClaims, UserProfile } from '@instasupply/shared';
import { onIdTokenChanged, signOut, type IdTokenResult, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
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

import { auth, db } from '@/lib/firebase';

export type SessionStatus =
  | 'loading'
  | 'signed_out'
  | 'staff_account'
  | 'shopper_account'
  | 'needs_profile'
  | 'needs_phone'
  | 'pending_approval'
  | 'suspended'
  | 'ready';

export interface Session {
  status: SessionStatus;
  user: User | null;
  profile: UserProfile | null;
  claims: AuthClaims;
  /** Force-refresh the ID token so new custom claims apply. */
  refreshClaims: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** Wait before retrying a token refresh that failed because the phone was offline. */
const TOKEN_RETRY_MS = 5_000;

function isNetworkError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'auth/network-request-failed';
}

function deriveStatus(
  user: User | null,
  authReady: boolean,
  profile: UserProfile | null,
  profileReady: boolean,
  claims: AuthClaims,
): SessionStatus {
  if (!authReady) return 'loading';
  if (!user) return 'signed_out';
  if (claims.role === 'admin' || claims.role === 'dispatcher') return 'staff_account';
  if (claims.role === 'customer') return 'shopper_account';
  if (!profileReady) return 'loading';
  if (!profile) return 'needs_profile';
  if (profile.status === 'suspended') return 'suspended';
  if (!profile.phoneVerified) return 'needs_phone';
  if (profile.status === 'pending') return 'pending_approval';
  // Approved, but this token predates approval: wait for the refreshed claims.
  if (claims.active !== true) return 'loading';
  return 'ready';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [claims, setClaims] = useState<AuthClaims>({});
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const refreshing = useRef(false);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;

    const applyUser = async (nextUser: User | null) => {
      clearTimeout(retry);
      if (!nextUser) {
        setUser(null);
        setClaims({});
        setAuthReady(true);
        return;
      }
      let token: IdTokenResult;
      try {
        token = await nextUser.getIdTokenResult();
      } catch (error) {
        if (auth.currentUser?.uid !== nextUser.uid) return; // A newer session has taken over.
        if (isNetworkError(error)) {
          // Offline with an expired token: keep the session and try again shortly.
          retry = setTimeout(() => void applyUser(nextUser), TOKEN_RETRY_MS);
          return;
        }
        // The saved session can't be refreshed: the account was deleted or disabled, or the
        // emulators restarted without --persist. Sign out so the sign-in screen shows.
        await signOut(auth);
        return;
      }
      setClaims({
        role: token.claims.role as AuthClaims['role'],
        active: token.claims.active === true,
      });
      setUser(nextUser);
      setAuthReady(true);
    };

    const unsubscribe = onIdTokenChanged(auth, applyUser);
    return () => {
      clearTimeout(retry);
      unsubscribe();
    };
  }, []);

  const uid = user?.uid ?? null;
  useEffect(() => {
    setProfile(null);
    setProfileReady(false);
    if (!uid) return;
    return onSnapshot(
      doc(db, 'users', uid),
      (snapshot) => {
        setProfile(snapshot.exists() ? ({ uid, ...snapshot.data() } as UserProfile) : null);
        setProfileReady(true);
      },
      () => setProfileReady(true),
    );
  }, [uid]);

  const refreshClaims = useCallback(async () => {
    if (!auth.currentUser || refreshing.current) return;
    refreshing.current = true;
    try {
      await auth.currentUser.getIdToken(true);
    } catch (error) {
      // Being offline is not fatal; keep the session. Anything else means the session is dead,
      // so sign out rather than wait for claims that can never arrive.
      if (!isNetworkError(error)) await signOut(auth);
    } finally {
      refreshing.current = false;
    }
  }, []);

  // When dispatch approves the driver, pick up the new `active` claim automatically.
  const profileStatus = profile?.status;
  useEffect(() => {
    if (profileStatus === 'active' && claims.active !== true) void refreshClaims();
    if (profileStatus === 'pending' && !claims.role && user) void refreshClaims();
  }, [profileStatus, claims.active, claims.role, user, refreshClaims]);

  const value = useMemo<Session>(
    () => ({
      status: deriveStatus(user, authReady, profile, profileReady, claims),
      user,
      profile,
      claims,
      refreshClaims,
    }),
    [user, authReady, profile, profileReady, claims, refreshClaims],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

/** For screens inside the signed-in area, where a profile is guaranteed. */
export function useDriver(): { user: User; profile: UserProfile } {
  const { user, profile } = useSession();
  if (!user || !profile) throw new Error('useDriver called outside the signed-in area.');
  return { user, profile };
}
