import type { PublicConfig, SessionEndReason, SessionUser } from '@instasupply/api-client';
import { useConfig, useSessionCore } from '@instasupply/api-client/react';
import type { UserProfile } from '@instasupply/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { claimCheckoutDraft } from '@/features/checkout/checkout-draft';
import { api, describeError } from '@/lib/api';

import { isSigningUp, signOut, subscribeToSignUp } from './auth-service';

/** MARKETPLACE §7.2, docs/CLIENTS.md §2.2. `guest` browses the shop without an account. */
export type SessionStatus =
  'loading' | 'onboarding' | 'guest' | 'needs_profile' | 'needs_phone' | 'wrong_account' | 'ready';

/** Whether this server can verify phones at all (docs/CLIENTS.md §2.2). */
export type PhoneVerificationMode = PublicConfig['phoneVerification'];

export interface Session {
  status: SessionStatus;
  user: SessionUser | null;
  profile: UserProfile | null;
  /** Sign-up is still creating the profile: `status` stays "loading" instead of "needs_profile". */
  signingUp: boolean;
  /**
   * Set when "loading" can't finish on its own: there are tokens but the account can't be loaded and
   * nothing is cached, or the very first /config never arrived. The root layout shows it with
   * "Try again" and a sign-out link; screens never handle it.
   */
  problem: string | null;
  /** Try again after `problem`. */
  retry: () => void;
  /** Mark the intro slides as seen. */
  finishOnboarding: () => Promise<void>;
  /** Why the last session ended (expired, revoked, suspended…); null after `acknowledgeEnd`. */
  endReason: SessionEndReason | null;
  acknowledgeEnd: () => void;
  /** `config.phoneVerification`, downgraded to 'off' when this server cannot send a code. */
  phoneVerification: PhoneVerificationMode;
}

const ONBOARDED_KEY = 'instasupply.onboarded';
const SessionContext = createContext<Session | null>(null);

/** A production server with SMS going to the outbox can't deliver a code: treat it as 'off'. */
export function effectivePhoneVerification(config: PublicConfig | null): PhoneVerificationMode {
  if (!config) return 'off';
  if (config.environment === 'production' && config.smsDriver === 'outbox') return 'off';
  return config.phoneVerification;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const core = useSessionCore();
  const config = useConfig();
  const [configError, setConfigError] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const signingUp = useSyncExternalStore(subscribeToSignUp, isSigningUp, isSigningUp);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((value) => setOnboarded(value === '1'))
      .catch(() => setOnboarded(false));
  }, []);

  // The config store notifies after a failed first load too, so `error()` is read on each change.
  useEffect(() => {
    const read = () => {
      const error = api.config.error();
      setConfigError(error ? describeError(error) : null);
    };
    read();
    return api.config.subscribe(read);
  }, []);

  const { user, profile } = core;
  const uid = user?.uid ?? null;
  // Checkout choices (instructions, receiving, card) belong to one account: drop them on any change.
  useEffect(() => claimCheckoutDraft(uid), [uid]);
  const phoneVerification = effectivePhoneVerification(config);

  // `/me` shows a suspended profile while the session still works: end it (docs/CLIENTS.md §2.4).
  const suspended = profile?.status === 'suspended';
  useEffect(() => {
    if (suspended) void signOut();
  }, [suspended]);

  const status = useMemo<SessionStatus>(() => {
    if (core.status === 'restoring' || onboarded === null || config === null) return 'loading';
    if (!user) return onboarded ? 'guest' : 'onboarding';
    if (profile === null) return signingUp ? 'loading' : 'needs_profile';
    if (profile.role !== 'customer') return 'wrong_account';
    if (profile.status === 'suspended') return 'loading';
    if (phoneVerification === 'required' && !profile.phoneVerified) return 'needs_phone';
    return 'ready';
  }, [core.status, onboarded, config, user, profile, signingUp, phoneVerification]);

  const problem = core.problem ? describeError(core.problem) : config === null ? configError : null;

  const retry = useCallback(() => {
    api.session.retry();
    api.config.load().catch(() => undefined);
  }, []);

  const finishOnboarding = useCallback(async () => {
    setOnboarded(true);
    await AsyncStorage.setItem(ONBOARDED_KEY, '1').catch(() => undefined);
  }, []);

  const acknowledgeEnd = useCallback(() => api.session.acknowledgeEnd(), []);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      profile,
      signingUp,
      problem,
      retry,
      finishOnboarding,
      endReason: core.endReason,
      acknowledgeEnd,
      phoneVerification,
    }),
    [
      status,
      user,
      profile,
      signingUp,
      problem,
      retry,
      finishOnboarding,
      core.endReason,
      acknowledgeEnd,
      phoneVerification,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

/**
 * For 🔒 screens, below `<RequireAccount>` (or in a component it renders): a signed-in customer
 * is guaranteed there. Throws for guests, so never call it on a screen guests can open.
 */
export function useCustomer(): { user: SessionUser; profile: UserProfile } {
  const { user, profile } = useSession();
  if (!user || !profile) throw new Error('useCustomer called outside a signed-in screen.');
  return { user, profile };
}

/** The signed-in customer's uid, or null for a guest. Safe on every shop screen. */
export function useUid(): string | null {
  const { status, user } = useSession();
  return status === 'ready' && user ? user.uid : null;
}

/** Where each session state belongs; the redirect target for protected route groups. */
export function homeHref(status: SessionStatus) {
  switch (status) {
    case 'onboarding':
      return '/intro' as const;
    case 'needs_profile':
      return '/complete-profile' as const;
    case 'needs_phone':
      return '/verify-phone' as const;
    case 'wrong_account':
      return '/wrong-account' as const;
    case 'guest':
      // Guests shop too; this is only where a guarded group sends them (after the intro, say).
      return '/welcome' as const;
    default:
      return '/' as const;
  }
}
