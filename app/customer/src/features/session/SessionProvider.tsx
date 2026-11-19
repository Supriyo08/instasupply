import { describeError } from '@instasupply/expo-firebase';
import { COLLECTIONS, type AuthClaims, type UserProfile } from '@instasupply/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onIdTokenChanged, type IdTokenResult, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { auth, db } from '@/lib/firebase';

import { confirmCustomerClaim, isSigningUp, signOut, subscribeToSignUp } from './auth-service';

export type SessionStatus =
  'loading' | 'onboarding' | 'signed_out' | 'needs_profile' | 'needs_phone' | 'wrong_account' | 'ready';

export interface Session {
  status: SessionStatus;
  user: User | null;
  profile: UserProfile | null;
  claims: AuthClaims;
  /** Sign-up is still creating the profile: `status` stays "loading" instead of "needs_profile". */
  signingUp: boolean;
  /**
   * Set when "loading" can't finish on its own because the account could not be confirmed as a
   * shopping account. Show this message with a way to `retry` or sign out, not a spinner.
   */
  problem: string | null;
  /** Try again after `problem`; the session is plain "loading" while it does. */
  retry: () => void;
  /** Mark the intro slides as seen. */
  finishOnboarding: () => Promise<void>;
}

const ONBOARDED_KEY = 'instasupply.onboarded';
/** Wait before retrying a token refresh that failed because the device was offline. */
const TOKEN_RETRY_MS = 5_000;
const CLAIM_MISSING =
  "Your account setup hasn't finished on our side. Try again in a moment, or sign out and log in again.";
const SessionContext = createContext<Session | null>(null);

function isNetworkError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'auth/network-request-failed';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [claims, setClaims] = useState<AuthClaims>({});
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const claimCheck = useRef(0);
  const signingUp = useSyncExternalStore(subscribeToSignUp, isSigningUp, isSigningUp);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((value) => setOnboarded(value === '1'))
      .catch(() => setOnboarded(false));
  }, []);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    let latest = 0;

    const applyUser = async (next: User | null) => {
      const run = (latest += 1);
      clearTimeout(retry);
      if (!next) {
        setUser(null);
        setClaims({});
        setAuthReady(true);
        return;
      }
      // True once a newer auth event, or another account, has taken over while we waited.
      const superseded = () => run !== latest || auth.currentUser?.uid !== next.uid;
      let token: IdTokenResult;
      try {
        token = await next.getIdTokenResult();
      } catch (error) {
        if (superseded()) return;
        if (isNetworkError(error)) {
          // Offline with an expired token: keep the session and try again shortly.
          retry = setTimeout(() => void applyUser(next), TOKEN_RETRY_MS);
          return;
        }
        // The saved session can't be refreshed: the account was deleted or disabled, or the
        // emulators restarted without --persist. Sign out so the login screen shows (the sign-out
        // comes back here as a null user; if even that fails, show the login screen regardless).
        await signOut().catch(() => applyUser(null));
        return;
      }
      if (superseded()) return;
      setClaims({ role: token.claims.role as AuthClaims['role'], active: token.claims.active === true });
      setUser(next);
      setAuthReady(true);
    };

    const unsubscribe = onIdTokenChanged(auth, applyUser);
    return () => {
      latest += 1; // Drop a token request that is still in flight.
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
      doc(db, COLLECTIONS.users, uid),
      // Needed for the check below: when the server confirms that there is no profile, only the
      // snapshot's metadata changes.
      { includeMetadataChanges: true },
      (snapshot) => {
        // While Firestore can't be reached the SDK answers from its cache, which is empty after a
        // cold start. A document missing there says nothing about the account, so wait for the
        // server (the session stays "loading") instead of asking a shopper for a new profile.
        if (!snapshot.exists() && snapshot.metadata.fromCache) return;
        setProfile(snapshot.exists() ? ({ uid, ...snapshot.data() } as UserProfile) : null);
        setProfileReady(true);
      },
      () => setProfileReady(true),
    );
  }, [uid]);

  // A verified shopper whose token carries no role: the shop can't open until the claim is there.
  const awaitingClaim =
    !!user && !signingUp && profile?.role === 'customer' && profile.phoneVerified && !claims.role;
  const activeProfileName = profile?.status === 'active' ? profile.displayName : null;

  const confirmClaim = useCallback(async () => {
    const run = (claimCheck.current += 1);
    let outcome: string | null;
    try {
      // On success the token listener above applies the new claim, which ends the wait.
      outcome = (await confirmCustomerClaim(activeProfileName)) ? null : CLAIM_MISSING;
    } catch (error) {
      outcome = describeError(error);
    }
    if (run === claimCheck.current) setProblem(outcome);
  }, [activeProfileName]);

  useEffect(() => {
    if (!awaitingClaim) return;
    void confirmClaim();
    return () => {
      claimCheck.current += 1; // Ignore a check that is still running.
      setProblem(null);
    };
  }, [awaitingClaim, confirmClaim]);

  const retry = useCallback(() => {
    setProblem(null);
    void confirmClaim();
  }, [confirmClaim]);

  const finishOnboarding = useCallback(async () => {
    setOnboarded(true);
    await AsyncStorage.setItem(ONBOARDED_KEY, '1').catch(() => undefined);
  }, []);

  const status = useMemo<SessionStatus>(() => {
    if (!authReady || onboarded === null) return 'loading';
    if (!user) return onboarded ? 'signed_out' : 'onboarding';
    if (claims.role && claims.role !== 'customer') return 'wrong_account';
    if (!profileReady) return 'loading';
    // During sign-up the profile is on its way: don't send the shopper to /complete-profile.
    if (!profile) return signingUp ? 'loading' : 'needs_profile';
    if (profile.role !== 'customer') return 'wrong_account';
    if (!profile.phoneVerified) return 'needs_phone';
    if (claims.role !== 'customer') return 'loading';
    return 'ready';
  }, [authReady, onboarded, user, claims.role, profileReady, profile, signingUp]);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      profile,
      claims,
      signingUp,
      problem: awaitingClaim ? problem : null,
      retry,
      finishOnboarding,
    }),
    [status, user, profile, claims, signingUp, awaitingClaim, problem, retry, finishOnboarding],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

/** For screens inside the signed-in shop, where a customer profile is guaranteed. */
export function useCustomer(): { user: User; profile: UserProfile } {
  const { user, profile } = useSession();
  if (!user || !profile) throw new Error('useCustomer called outside the signed-in area.');
  return { user, profile };
}

/** Where each session state belongs; the redirect target for protected route groups. */
export function homeHref(status: SessionStatus) {
  switch (status) {
    case 'onboarding':
      return '/intro' as const;
    case 'signed_out':
      return '/welcome' as const;
    case 'needs_profile':
      return '/complete-profile' as const;
    case 'needs_phone':
      return '/verify-phone' as const;
    case 'wrong_account':
      return '/wrong-account' as const;
    default:
      return '/' as const;
  }
}
