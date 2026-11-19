import { COLLECTIONS, type UserProfile } from '@instasupply/shared';

import { db } from './admin';

export const userRef = (uid: string) => db.collection(COLLECTIONS.users).doc(uid);

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await userRef(uid).get();
  return snapshot.exists ? ({ uid, ...snapshot.data() } as UserProfile) : null;
}

const STAFF_CACHE_MS = 60_000;
let staffCache: { at: number; admins: string[]; all: string[] } | null = null;

/** Active staff uids, cached briefly per function instance to avoid a query per notification. */
export async function getActiveStaffIds(options: { adminsOnly?: boolean } = {}): Promise<string[]> {
  if (!staffCache || Date.now() - staffCache.at > STAFF_CACHE_MS) {
    const snapshot = await db
      .collection(COLLECTIONS.users)
      .where('role', 'in', ['admin', 'dispatcher'])
      .where('status', '==', 'active')
      .get();
    const admins: string[] = [];
    const all: string[] = [];
    for (const doc of snapshot.docs) {
      all.push(doc.id);
      if (doc.get('role') === 'admin') admins.push(doc.id);
    }
    staffCache = { at: Date.now(), admins, all };
  }
  return options.adminsOnly ? staffCache.admins : staffCache.all;
}

export function vehicleLabel(profile: Pick<UserProfile, 'vehicle'> | null): string | null {
  const vehicle = profile?.vehicle;
  if (!vehicle) return null;
  const parts = [vehicle.model, vehicle.plate].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
