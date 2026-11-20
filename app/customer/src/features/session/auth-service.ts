import type { AccountType } from '@instasupply/shared';

import { api, describeError } from '@/lib/api';
import { call } from '@/lib/callables';

/**
 * The account flows of docs/CLIENTS.md §2.2. Sign-up is `register` (an account without a role)
 * followed by `registerCustomer` (the shopping profile). While that runs, `isSigningUp()` is true
 * and the session reports "loading" instead of "needs_profile". If the account exists but its
 * profile could not be created, `getSignUpFailure` lets /complete-profile pre-fill and explain.
 */
interface SignUpState {
  pending: boolean;
  failure: { uid: string; name: string; message: string } | null;
}

// Sign-up may collect the phone number; verification happens on the next screen.
let pendingPhone: string | null = null;
/** The phone typed at sign-up, to pre-fill /verify-phone. */
export const rememberedSignUpPhone = () => pendingPhone;

let signUp: SignUpState = { pending: false, failure: null };
const signUpListeners = new Set<() => void>();

function setSignUp(next: SignUpState) {
  signUp = next;
  signUpListeners.forEach((listener) => listener());
}

/** For `useSyncExternalStore`: the listener runs whenever `isSigningUp()` may have changed. */
export function subscribeToSignUp(listener: () => void) {
  signUpListeners.add(listener);
  return () => {
    signUpListeners.delete(listener);
  };
}

/** True while `createAccount` is between `register` and the end of `registerCustomer`. */
export const isSigningUp = () => signUp.pending;

/** Why sign-up stopped after creating this account, if it did. */
export const getSignUpFailure = (uid: string | undefined) =>
  signUp.failure?.uid === uid ? signUp.failure : null;

/** Call once the failure is on screen, so it isn't repeated for another account later. */
export function clearSignUpFailure() {
  if (signUp.failure) setSignUp({ ...signUp, failure: null });
}

export async function signIn(email: string, password: string) {
  await api.session.signIn({ email: email.trim().toLowerCase(), password });
}

export interface CreateAccountInput {
  name: string;
  email: string;
  password: string;
  companyName?: string | null;
  accountType?: AccountType | null;
  /** "Send me deals" (CASL): off unless ticked. */
  marketingOptIn?: boolean;
  /** E.164; only remembered for /verify-phone. */
  phone?: string | null;
}

/** Creates the account, then the shopping profile (`registerCustomer`), then reloads /me. */
export async function createAccount(input: CreateAccountInput) {
  const name = input.name.trim();
  pendingPhone = input.phone ?? null;
  setSignUp({ pending: true, failure: null });
  try {
    await api.session.register({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      displayName: name,
    });
  } catch (error) {
    setSignUp({ pending: false, failure: null });
    throw error;
  }
  try {
    await completeProfile({
      displayName: name,
      companyName: input.companyName ?? null,
      accountType: input.accountType ?? null,
      marketingOptIn: input.marketingOptIn ?? false,
    });
    setSignUp({ pending: false, failure: null });
  } catch (error) {
    // With an account but no profile the session moves on to "needs_profile": record why first.
    const uid = api.session.getSnapshot().user?.uid;
    setSignUp({ pending: false, failure: uid ? { uid, name, message: describeError(error) } : null });
    throw error;
  }
}

export interface CompleteProfileInput {
  displayName: string;
  companyName?: string | null;
  accountType?: AccountType | null;
  marketingOptIn?: boolean;
}

/** Creates or repairs the shopping profile; also used after an interrupted sign-up. */
export async function completeProfile(input: CompleteProfileInput) {
  await call('registerCustomer', { ...input, displayName: input.displayName.trim() });
  await api.session.refreshProfile();
}

export function requestPhoneCode(phoneNumber: string) {
  return call('requestPhoneOtp', { phoneNumber });
}

export async function verifyPhoneCode(code: string) {
  const result = await call('verifyPhoneOtp', { code });
  await api.session.refreshProfile();
  return result;
}

/** Step 1 of the forgot-password screen: the server emails a 6-digit code. */
export function requestPasswordReset(email: string) {
  return api.session.requestPasswordReset(email.trim().toLowerCase());
}

/** Step 2: the code from the email and the new password. */
export function resetPassword(input: { email: string; code: string; newPassword: string }) {
  return api.session.resetPassword({ ...input, email: input.email.trim().toLowerCase() });
}

/** Signed-in "Change password" form. */
export function changePassword(input: { currentPassword: string; newPassword: string }) {
  return api.session.changePassword(input);
}

/**
 * Ends the session on this device. Never rejects: `POST /auth/logout` also removes this install's
 * push device; offline, the logout is queued (docs/CLIENTS.md §2.5). Clearing the cart is the
 * caller's job (`useSignOut`), because only screens hold the cart.
 */
export function signOut() {
  return api.session.signOut();
}
