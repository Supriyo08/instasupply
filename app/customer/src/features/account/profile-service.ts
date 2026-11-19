import { COLLECTIONS, type UserPreferences } from '@instasupply/shared';
import { updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { auth, db } from '@/lib/firebase';

/**
 * Profile writes allowed by the security rules: only displayName, vehicle, photoURL, preferences
 * and updatedAt may change on users/{uid}.
 */
export async function updateDisplayName(uid: string, displayName: string) {
  await updateDoc(doc(db, COLLECTIONS.users, uid), { displayName, updatedAt: serverTimestamp() });
  // Keep the Auth profile in step (best effort: Firestore is the source of truth).
  const current = auth.currentUser;
  if (current?.uid === uid) await updateProfile(current, { displayName }).catch(() => undefined);
}

export async function updatePreferences(
  uid: string,
  current: UserPreferences | undefined,
  changes: Partial<UserPreferences>,
) {
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    preferences: { ...current, ...changes },
    updatedAt: serverTimestamp(),
  });
}

/** A usable display name (2–80 characters after collapsing whitespace), or null. */
export function cleanDisplayName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 80 ? name : null;
}
