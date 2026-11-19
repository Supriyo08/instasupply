/** Every SQL statement of the auth module on `users`, `auth_tokens` and `otp_challenges` (docs/PLATFORM.md §3.2). */
import type {
  AccountStatus,
  CityId,
  Role,
  StoreRole,
  UserPreferences,
  VehicleClass,
} from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable;

/** The `doc` of a user: the rest of UserProfile (§3.3). */
export interface UserDoc {
  photoPath?: string | null;
  preferences?: UserPreferences;
  suspendedReason?: string | null;
  [key: string]: unknown;
}

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string | null;
  failed_logins: number;
  role: Role | null;
  status: AccountStatus;
  display_name: string;
  phone_number: string | null;
  phone_verified: boolean;
  store_id: string | null;
  store_role: StoreRole | null;
  city_id: CityId | null;
  capacity_class: VehicleClass | null;
  doc: UserDoc;
  created_at: number;
  updated_at: number;
}

const COLUMNS = `id, email, password_hash, failed_logins, role, status, display_name, phone_number, phone_verified,
  store_id, store_role, city_id, capacity_class, doc, created_at, updated_at`;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export async function findUserByEmail(db: Db, email: string): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRecord>(`SELECT ${COLUMNS} FROM users WHERE lower(email) = $1`, [
    normalizeEmail(email),
  ]);
  return rows[0] ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRecord>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** The user row under FOR NO KEY UPDATE (rank 1 of §3.6). */
export async function lockUser(tx: Tx, id: string): Promise<UserRecord | null> {
  const { rows } = await tx.query<UserRecord>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

export interface NewUser {
  id: string;
  email: string;
  passwordHash: string | null;
  role: Role | null;
  status: AccountStatus;
  displayName: string;
  storeId?: string | null;
  storeRole?: StoreRole | null;
  doc: UserDoc;
}

/** Throws the PostgreSQL unique violation (23505) when the email is taken; callers map it. */
export async function insertUser(tx: Tx, user: NewUser): Promise<void> {
  await tx.query(
    `INSERT INTO users (id, email, password_hash, password_changed_at, role, status, display_name, store_id, store_role,
                        doc, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)`,
    [
      user.id,
      normalizeEmail(user.email),
      user.passwordHash,
      user.passwordHash ? new Date(tx.now) : null,
      user.role,
      user.status,
      user.displayName,
      user.storeId ?? null,
      user.storeRole ?? null,
      JSON.stringify(user.doc),
      new Date(tx.now),
    ],
  );
  await publishUser(tx, user.id, user.role);
}

/** Every write to an account announces itself on user:{uid}, so clients reload GET /me (§6.4). */
export async function publishUser(tx: Tx, uid: string, role: Role | null): Promise<void> {
  await publishChange(tx, 'users', 'updated', { uid, role });
}

export async function setPassword(tx: Tx, uid: string, hash: string): Promise<void> {
  await tx.query(
    `UPDATE users SET password_hash = $2, password_changed_at = $3, failed_logins = 0, updated_at = $3 WHERE id = $1`,
    [uid, hash, new Date(tx.now)],
  );
}

export async function recordLogin(tx: Tx, uid: string, rehash: string | null): Promise<void> {
  await tx.query(
    `UPDATE users SET failed_logins = 0, last_login_at = $2, password_hash = COALESCE($3, password_hash) WHERE id = $1`,
    [uid, new Date(tx.now), rehash],
  );
}

/** Autocommit: the diagnostic counter survives the failed request. Returns the new count. */
export async function countFailedLogin(db: Db, uid: string): Promise<number> {
  const { rows } = await db.query<{ failed_logins: number }>(
    'UPDATE users SET failed_logins = failed_logins + 1 WHERE id = $1 RETURNING failed_logins',
    [uid],
  );
  return rows[0]?.failed_logins ?? 0;
}

export async function setStatus(
  tx: Tx,
  user: Pick<UserRecord, 'id' | 'role' | 'doc'>,
  status: AccountStatus,
  reason: string | null,
): Promise<void> {
  await tx.query(`UPDATE users SET status = $2, doc = doc || $3::jsonb, updated_at = $4 WHERE id = $1`, [
    user.id,
    status,
    JSON.stringify({ suspendedReason: status === 'suspended' ? reason : null }),
    new Date(tx.now),
  ]);
  await publishUser(tx, user.id, user.role);
}

// ---------- auth_tokens: reset codes and set-password links ----------

export interface AuthTokenRow {
  id: string;
  user_id: string;
  purpose: 'password_reset' | 'set_password';
  secret_hash: string;
  attempts: number;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

/** Replaces the user's active token of that purpose (delete, insert): one valid code or link at a time. */
export async function replaceAuthToken(
  tx: Tx,
  input: {
    id: string;
    userId: string;
    purpose: AuthTokenRow['purpose'];
    secretHash: string;
    expiresAt: number;
    createdBy: string | null;
  },
): Promise<void> {
  await tx.query('DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [
    input.userId,
    input.purpose,
  ]);
  await tx.query(
    `INSERT INTO auth_tokens (id, user_id, purpose, secret_hash, created_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.userId,
      input.purpose,
      input.secretHash,
      input.createdBy,
      new Date(tx.now),
      new Date(input.expiresAt),
    ],
  );
}

export async function findActiveAuthToken(
  db: Db,
  userId: string,
  purpose: AuthTokenRow['purpose'],
  lock = false,
): Promise<AuthTokenRow | null> {
  const { rows } = await db.query<AuthTokenRow>(
    `SELECT id, user_id, purpose, secret_hash, attempts, created_at, expires_at, used_at FROM auth_tokens
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL${lock ? ' FOR NO KEY UPDATE' : ''}`,
    [userId, purpose],
  );
  return rows[0] ?? null;
}

export async function findAuthTokenById(db: Db, id: string, lock = false): Promise<AuthTokenRow | null> {
  const { rows } = await db.query<AuthTokenRow>(
    `SELECT id, user_id, purpose, secret_hash, attempts, created_at, expires_at, used_at FROM auth_tokens
      WHERE id = $1${lock ? ' FOR NO KEY UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markAuthTokenUsed(tx: Tx, id: string): Promise<void> {
  await tx.query('UPDATE auth_tokens SET used_at = $2 WHERE id = $1', [id, new Date(tx.now)]);
}

export async function countAuthTokenAttempt(db: Db, id: string): Promise<void> {
  await db.query('UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = $1', [id]);
}

export async function deleteAuthToken(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM auth_tokens WHERE id = $1', [id]);
}
