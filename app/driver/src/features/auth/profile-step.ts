/** Checks of the onboarding profile step (MARKETPLACE §10), the same name rule as the server's `registerDriver`. */
import type { CityId } from '@instasupply/shared';

export const DISPLAY_NAME_MAX = 80;

/** Trimmed, inner whitespace collapsed (backend/src/modules/drivers/schemas.ts `name`). */
export function cleanDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function checkProfileStep(name: string, cityId: CityId | null): { name?: string; city?: string } {
  const clean = cleanDisplayName(name);
  const errors: { name?: string; city?: string } = {};
  if (!clean) errors.name = 'Enter your full name.';
  else if (clean.length > DISPLAY_NAME_MAX)
    errors.name = `Keep your name to ${DISPLAY_NAME_MAX} characters or fewer.`;
  if (!cityId) errors.city = 'Pick the city you drive in.';
  return errors;
}
