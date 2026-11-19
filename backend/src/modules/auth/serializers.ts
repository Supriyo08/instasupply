/** The API shapes of the auth module (docs/PLATFORM.md §3.3, §6.2): UserProfile, MeResponse, SessionInfo. */
import type {
  ClientApp,
  DevicePlatform,
  MeResponse,
  SessionInfo,
  Store,
  UserProfile,
} from '@instasupply/shared';
import type { Queryable } from '../../platform/db/tx';
import { mediaUrl } from '../../platform/storage/files.service';
import { findUserById, type UserRecord } from './users.repository';

type Db = Queryable;

/** `uid`, the account columns, `doc` without photoPath, `photoURL` derived. Null while the account has no role. */
export function toUserProfile(row: UserRecord, origin: string): UserProfile | null {
  if (row.role === null) return null;
  const { photoPath, ...doc } = row.doc;
  return {
    ...doc,
    uid: row.id,
    role: row.role,
    status: row.status,
    displayName: row.display_name,
    email: row.email,
    phoneNumber: row.phone_number,
    phoneVerified: row.phone_verified,
    photoURL: mediaUrl(origin, photoPath ?? null),
    storeId: row.store_id,
    storeRole: row.store_role,
    cityId: row.city_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as UserProfile;
}

/** A profile that must exist (an account with a role); staff screens never list role-less accounts. */
export function requireProfile(row: UserRecord, origin: string): UserProfile {
  const profile = toUserProfile(row, origin);
  if (!profile) throw new Error(`user ${row.id} has no role`);
  return profile;
}

interface StoreRow {
  id: string;
  doc: Omit<Store, 'id' | 'rating' | 'ratingCount' | 'createdAt' | 'updatedAt' | 'photoUrl'> & {
    photoPath?: string | null;
  };
  rating_sum: number;
  rating_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * The public Store of a supplier's own store (§3.3 composition). The stores module owns the full catalogue
 * serializer; this one exists so GET /me does not depend on a wave-2 module.
 */
async function loadStore(db: Db, storeId: string, origin: string): Promise<Store | null> {
  const { rows } = await db.query<StoreRow>(
    'SELECT id, doc, rating_sum, rating_count, created_at, updated_at FROM stores WHERE id = $1',
    [storeId],
  );
  const row = rows[0];
  if (!row) return null;
  const { photoPath, ...doc } = row.doc;
  return {
    ...doc,
    id: row.id,
    photoUrl: mediaUrl(origin, photoPath ?? null),
    rating: row.rating_count ? Math.round((row.rating_sum * 10) / row.rating_count) / 10 : 0,
    ratingCount: row.rating_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Store;
}

export async function toMeResponse(
  db: Db,
  row: UserRecord,
  origin: string,
  now: number,
): Promise<MeResponse> {
  return {
    account: { uid: row.id, email: row.email, createdAt: row.created_at },
    profile: toUserProfile(row, origin),
    store: row.role === 'supplier' && row.store_id ? await loadStore(db, row.store_id, origin) : null,
    serverTime: now,
  };
}

export async function loadMe(db: Db, uid: string, origin: string, now: number): Promise<MeResponse> {
  const row = await findUserById(db, uid);
  if (!row) throw new Error(`user ${uid} vanished`);
  return toMeResponse(db, row, origin, now);
}

export interface SessionRecord {
  id: string;
  app: ClientApp;
  platform: DevicePlatform | null;
  device_name: string | null;
  created_at: number;
  last_used_at: number;
}

export const toSessionInfo = (row: SessionRecord, currentId: string | null): SessionInfo => ({
  id: row.id,
  app: row.app,
  platform: row.platform,
  deviceName: row.device_name,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  current: row.id === currentId,
});
