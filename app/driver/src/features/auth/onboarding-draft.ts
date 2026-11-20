/**
 * What the driver entered on the onboarding steps profile → vehicle → attest (MARKETPLACE §10). Nothing
 * is sent until the attest step calls `completeProfile` (registerDriver) with all of it. Memory only:
 * a restarted app starts the steps again, which is cheap and keeps no personal data on the device.
 */
import type { CityId, DriverVehicleInput } from '@instasupply/shared';
import { useSyncExternalStore } from 'react';

export interface OnboardingDraft {
  displayName: string;
  cityId: CityId | null;
  vehicle: Partial<DriverVehicleInput>;
}

const EMPTY: OnboardingDraft = { displayName: '', cityId: null, vehicle: {} };
let draft: OnboardingDraft = EMPTY;
const listeners = new Set<() => void>();

export function getOnboardingDraft(): OnboardingDraft {
  return draft;
}

export function updateOnboardingDraft(patch: Partial<OnboardingDraft>): void {
  draft = { ...draft, ...patch, vehicle: { ...draft.vehicle, ...patch.vehicle } };
  for (const listener of [...listeners]) listener();
}

export function resetOnboardingDraft(): void {
  draft = EMPTY;
  for (const listener of [...listeners]) listener();
}

export function useOnboardingDraft(): OnboardingDraft {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => draft,
    () => draft,
  );
}
