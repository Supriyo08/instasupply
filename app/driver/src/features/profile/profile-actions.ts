/** Calls of the Profile screen (docs/CLIENTS.md §4.6 profile row). Sign-out is `useSignOut`. */
import type { UserPreferences } from '@instasupply/shared';

import { api, call } from '@/lib/api';

/** Merged into the stored preferences by the server; the session profile updates with the answer. */
export async function updatePreferences(preferences: Partial<UserPreferences>) {
  await api.session.updateProfile({ preferences });
}

/** A test push to every device of this driver; it also lands in the inbox. Returns how many devices. */
export async function sendTestNotification(): Promise<number> {
  const result = await call('sendTestNotification', {});
  return result.devices;
}
