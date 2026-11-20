import type { ProfilePatch } from '@instasupply/api-client';
import type { UserPreferences } from '@instasupply/shared';

import { api } from '@/lib/api';

/** Saves the display name; the session snapshot (and every screen) updates from the answer. */
export async function updateDisplayName(displayName: string) {
  await api.session.updateProfile({ displayName });
}

/** Saves preference changes (order updates, deals, chat); the server merges them into the stored ones. */
export async function updatePreferences(changes: Partial<UserPreferences>) {
  await api.session.updateProfile({ preferences: changes });
}

/** Any other profile field the account screens edit (company, account type, photo path). */
export async function updateProfile(patch: ProfilePatch) {
  await api.session.updateProfile(patch);
}

/** A usable display name (2–80 characters after collapsing whitespace), or null. */
export function cleanDisplayName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 80 ? name : null;
}
