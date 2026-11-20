/**
 * Every SQL statement of the drivers module on `users` and `driver_locations` (docs/PLATFORM.md §2.1). A
 * driver's account columns (`role`, `status`, `display_name`, `city_id`) and the driver keys of `doc`
 * (`vehicle`, `vehicleDraft`, `vehicleReviewRequired`, `compliance`, `payoutAccount`, `approvedBy`,
 * `approvedAt`, `suspendedReason`, `preferences`) are written here; `capacity_class` follows `doc.vehicle`.
 */
import type { AccountStatus, CityId, DriverLocation, Role, UserProfile, WithId } from '@instasupply/shared';
import { lockRows, type UserRow } from '../../platform/db/locks';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable;

/** The driver keys of `users.doc`. */
export type DriverDoc = Pick<
  UserProfile,
  | 'vehicle'
  | 'vehicleDraft'
  | 'vehicleReviewRequired'
  | 'compliance'
  | 'payoutAccount'
  | 'approvedBy'
  | 'approvedAt'
  | 'suspendedReason'
  | 'preferences'
  | 'driverStats'
>;

export async function lockUserRow(tx: Tx, uid: string): Promise<UserRow | null> {
  const [row] = await lockRows<UserRow>(tx, 'users', [uid]);
  return row ?? null;
}

export async function findUserRow(db: Db, uid: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [uid]);
  return rows[0] ?? null;
}

export interface UserPatch {
  role?: Role;
  status?: AccountStatus;
  displayName?: string;
  cityId?: CityId | null;
  /** Merged into `doc` (top-level keys replaced). */
  doc?: Partial<DriverDoc>;
}

/** Updates a locked user row and announces it on `user:{uid}` and `ops:drivers` (§8.2). */
export async function updateUser(tx: Tx, uid: string, patch: UserPatch): Promise<void> {
  const sets: string[] = ['updated_at = $2'];
  const values: unknown[] = [uid, new Date(tx.now)];
  const set = (column: string, value: unknown, cast = '') => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.role !== undefined) set('role', patch.role);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.displayName !== undefined) set('display_name', patch.displayName);
  if (patch.cityId !== undefined) set('city_id', patch.cityId);
  if (patch.doc !== undefined) {
    values.push(JSON.stringify(patch.doc));
    sets.push(`doc = doc || $${values.length}::jsonb`);
  }
  await tx.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, values);
  await publishChange(tx, 'users', 'updated', { uid, role: patch.role ?? 'driver' });
}

interface LocationRow {
  driver_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  battery: number | null;
  online: boolean;
  updated_at: number;
}

const toLocation = (row: LocationRow): WithId<DriverLocation> => ({
  id: row.driver_id,
  lat: row.lat,
  lng: row.lng,
  heading: row.heading,
  speed: row.speed,
  accuracy: row.accuracy,
  online: row.online,
  battery: row.battery,
  updatedAt: row.updated_at,
});

/** markStaleDriversOffline: one UPDATE, then one live event per driver it turned offline. */
export async function setStaleDriversOffline(tx: Tx, before: number): Promise<number> {
  const { rows } = await tx.query<LocationRow>(
    `UPDATE driver_locations SET online = false WHERE online AND updated_at < $1
      RETURNING driver_id, lat, lng, heading, speed, accuracy, battery, online, updated_at`,
    [new Date(before)],
  );
  for (const row of rows) await publishChange(tx, 'driver_locations', 'updated', toLocation(row));
  return rows.length;
}
