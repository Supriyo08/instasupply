/** Account flows of the driver app (docs/CLIENTS.md §2.3, §2.5). Screens call these, never the core directly. */
import type { DriverVehicleInput, RegisterDriverRequest } from '@instasupply/shared';

import { cleanUpLocationAfterSessionEnd } from '@/features/location/session-cleanup';
import { api, call } from '@/lib/api';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function signIn(email: string, password: string) {
  await api.session.signIn({ email: normalizeEmail(email), password });
}

/** Step 1 of onboarding: the account, without a role. The session then shows the profile steps. */
export async function createAccount(name: string, email: string, password: string) {
  await api.session.register({ email: normalizeEmail(email), password, displayName: name.trim() });
}

/** The name given at sign-up, while the account has no profile yet (the core keeps it). */
export function rememberedSignUpName(): string | null {
  return api.session.getSnapshot().user?.displayName ?? null;
}

/** Last onboarding step: create the driver profile (pending approval), then reload `/me`. */
export async function completeProfile(request: RegisterDriverRequest) {
  await call('registerDriver', request);
  await api.session.refreshProfile();
}

export async function requestPhoneCode(phoneNumber: string) {
  return call('requestPhoneOtp', { phoneNumber });
}

export async function verifyPhoneCode(code: string) {
  const result = await call('verifyPhoneOtp', { code });
  await api.session.refreshProfile();
  return result;
}

/** A vehicle change goes to `vehicleDraft` until ops review it ("Pending review"). */
export async function submitVehicle(vehicle: DriverVehicleInput) {
  await call('updateDriverVehicle', { vehicle });
  await api.session.refreshProfile();
}

/** Step 1 of the forgot-password flow: a 6-digit code is emailed (204 whether or not the account exists). */
export async function requestPasswordReset(email: string) {
  await api.session.requestPasswordReset(normalizeEmail(email));
}

/** Step 2: the code from the email and the new password. */
export async function resetPassword(input: { email: string; code: string; newPassword: string }) {
  await api.session.resetPassword({ ...input, email: normalizeEmail(input.email) });
}

/**
 * The one sign-out path for every screen outside `(app)` (onboarding, wrong account, suspended), and
 * the last step of `useSignOut` inside it. Never rejects. `POST /auth/logout` also removes this
 * install's push device on the server (§2.5), so no `unregisterDevice` call is needed.
 */
export async function signOut() {
  await cleanUpLocationAfterSessionEnd();
  await api.session.signOut();
}

/** "Back to sign in" on the suspended screen: forget why the last session ended. */
export function acknowledgeSessionEnd() {
  api.session.acknowledgeEnd();
}
