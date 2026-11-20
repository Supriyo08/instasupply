/**
 * Step numbers of the onboarding progress header (MARKETPLACE §10: account → profile → vehicle →
 * attest → verify-phone → pending). The account step is the sign-up screen.
 */
export const ONBOARDING_STEPS = {
  account: 1,
  profile: 2,
  vehicle: 3,
  attest: 4,
  verifyPhone: 5,
  pending: 6,
  total: 6,
} as const;
