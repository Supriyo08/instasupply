import { describeError } from '@instasupply/expo-firebase';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';

import { call } from '@/lib/callables';
import { auth } from '@/lib/firebase';

// Sign-up collects the phone number, but verification happens on the next screen.
let pendingPhone: string | null = null;
export const rememberedSignUpPhone = () => pendingPhone;

/**
 * Sign-up creates the Firebase user first and the shopping profile right after. While `pending`,
 * the session reports "loading" instead of "needs_profile". If the account exists but its profile
 * could not be created, `failure` lets /complete-profile pre-fill the name and say what happened.
 */
interface SignUpState {
  pending: boolean;
  failure: { uid: string; name: string; message: string } | null;
}

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

/** True while `createAccount` is still creating the account and its profile. */
export const isSigningUp = () => signUp.pending;

/** Why sign-up stopped after creating this account, if it did. */
export const getSignUpFailure = (uid: string | undefined) =>
  signUp.failure?.uid === uid ? signUp.failure : null;

/** Call once the failure is on screen, so it isn't repeated for another account later. */
export function clearSignUpFailure() {
  if (signUp.failure) setSignUp({ ...signUp, failure: null });
}

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

/** Create the account and the shopping profile, then pick up the `customer` role claim. */
export async function createAccount(input: {
  name: string;
  email: string;
  phone: string | null;
  password: string;
}) {
  pendingPhone = input.phone;
  const name = input.name.trim();
  setSignUp({ pending: true, failure: null });
  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      input.email.trim().toLowerCase(),
      input.password,
    );
    await updateProfile(credential.user, { displayName: name });
    await completeProfile(name);
    setSignUp({ pending: false, failure: null });
  } catch (error) {
    // With an account but no profile the session moves on to "needs_profile": record why first.
    const uid = auth.currentUser?.uid;
    setSignUp({ pending: false, failure: uid ? { uid, name, message: describeError(error) } : null });
    throw error;
  }
}

/** Creates/updates the profile; also used to recover if sign-up was interrupted. */
export async function completeProfile(name: string) {
  await call('registerCustomer', { displayName: name.trim() });
  await auth.currentUser?.getIdToken(true);
}

/**
 * Makes sure the signed-in shopper's ID token carries the `customer` role. The claim may only be
 * newer than the token, so refresh first. If it is really missing (registration stopped before the
 * claim was set), `registerCustomer` re-applies it for an active profile: pass that profile's name,
 * or null when the profile isn't active. Resolves false when the role still isn't there.
 */
export async function confirmCustomerClaim(activeProfileName: string | null): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return true;
  const hasClaim = async () => (await user.getIdTokenResult(true)).claims.role === 'customer';
  if (await hasClaim()) return true;
  if (activeProfileName === null) return false;
  await call('registerCustomer', { displayName: activeProfileName });
  return hasClaim();
}

export async function requestPhoneCode(phoneNumber: string) {
  return call('requestPhoneOtp', { phoneNumber });
}

export async function verifyPhoneCode(code: string) {
  const result = await call('verifyPhoneOtp', { code });
  await auth.currentUser?.reload();
  await auth.currentUser?.getIdToken(true);
  return result;
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export async function signOut() {
  await firebaseSignOut(auth);
}
