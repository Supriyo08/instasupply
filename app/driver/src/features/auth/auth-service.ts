import type { RegisterDriverRequest } from '@instasupply/shared';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';

import { call } from '@/lib/callables';
import { auth } from '@/lib/firebase';

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

// The session moves on as soon as the account exists, before the display name is saved,
// so the next onboarding step reads the name from here.
let signUpName: string | null = null;
export const rememberedSignUpName = () => signUpName;

/** Step 1 of onboarding: the Auth account. The session then asks for vehicle details. */
export async function createAccount(name: string, email: string, password: string) {
  signUpName = name.trim();
  const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await updateProfile(credential.user, { displayName: name.trim() });
}

/** Step 2: create the driver profile (pending approval) and pick up the new role claim. */
export async function completeProfile(profile: RegisterDriverRequest) {
  await call('registerDriver', profile);
  await auth.currentUser?.getIdToken(true);
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
