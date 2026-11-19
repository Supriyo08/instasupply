/**
 * The caller of a request, re-read from `users` and `sessions` on every request (docs/PLATFORM.md §6.4): a
 * suspension, role change, store change or vehicle approval takes effect on the very next request.
 */
import type {
  AccountStatus,
  AuthFailureReason,
  CityId,
  Role,
  StoreRole,
  VehicleClass,
} from '@instasupply/shared';
import type pg from 'pg';

export interface Actor {
  uid: string;
  sessionId: string;
  email: string;
  role: Role | null;
  status: AccountStatus;
  name: string;
  isStaff: boolean;
  isAdmin: boolean;
  /** status === 'active' (approved, not suspended). */
  isActive: boolean;
  phoneVerified: boolean;
  storeId: string | null;
  storeRole: StoreRole | null;
  cityId: CityId | null;
  capacityClass: VehicleClass | null;
}

interface ActorRow {
  id: string;
  email: string;
  role: Role | null;
  status: AccountStatus;
  display_name: string;
  phone_verified: boolean;
  store_id: string | null;
  store_role: StoreRole | null;
  city_id: CityId | null;
  capacity_class: VehicleClass | null;
  revoked_at: number | null;
  revoked_reason: string | null;
  expires_at: number;
  last_used_at: number;
}

export type ActorResult =
  | { ok: true; actor: Actor; lastUsedAt: number }
  | { ok: false; reason: Extract<AuthFailureReason, 'account_suspended' | 'session_revoked'> };

export function toActor(
  row: Omit<ActorRow, 'revoked_at' | 'revoked_reason' | 'expires_at' | 'last_used_at'>,
  sessionId: string,
): Actor {
  const isStaff = (row.role === 'admin' || row.role === 'dispatcher') && row.status === 'active';
  return {
    uid: row.id,
    sessionId,
    email: row.email,
    role: row.role,
    status: row.status,
    name: row.display_name,
    isStaff,
    isAdmin: isStaff && row.role === 'admin',
    isActive: row.status === 'active',
    phoneVerified: row.phone_verified,
    storeId: row.store_id,
    storeRole: row.store_role,
    cityId: row.city_id,
    capacityClass: row.capacity_class,
  };
}

/** One query by primary keys (§6.4 step 3). Suspension is checked before revocation, so it is always told. */
export async function loadActor(
  pool: Pick<pg.Pool, 'query'>,
  uid: string,
  sessionId: string,
  now: number,
): Promise<ActorResult> {
  const { rows } = await pool.query<ActorRow>(
    `SELECT u.id, u.email, u.role, u.status, u.display_name, u.phone_verified, u.store_id, u.store_role,
            u.city_id, u.capacity_class, s.revoked_at, s.revoked_reason, s.expires_at, s.last_used_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2`,
    [sessionId, uid],
  );
  const row = rows[0];
  if (row && (row.status === 'suspended' || row.revoked_reason === 'suspended')) {
    return { ok: false, reason: 'account_suspended' };
  }
  if (!row || row.revoked_at !== null || row.expires_at <= now)
    return { ok: false, reason: 'session_revoked' };
  return { ok: true, actor: toActor(row, sessionId), lastUsedAt: row.last_used_at };
}
