/**
 * Every SQL statement on `jobsites` (docs/PLATFORM.md §3.3, §5.3.3). The default flag moves with statement (n)
 * of §3.5: the owner's row is locked first, the old default is cleared, then the row is upserted, so two
 * concurrent "make this the default" requests queue on the user row and never trip jobsites_default_key.
 */
import type { Jobsite, JobsiteFields } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';

interface JobsiteRow {
  id: string;
  user_id: string;
  doc: JobsiteFields;
  is_default: boolean;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

const COLUMNS = 'id, user_id, doc, is_default, last_used_at, created_at, updated_at';

export const MAX_JOBSITES = 50;

export const toJobsite = (row: JobsiteRow): Jobsite => ({
  ...row.doc,
  id: row.id,
  isDefault: row.is_default,
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The default first, then the most recently used (§5.3.3). */
export async function listJobsites(db: Queryable, userId: string): Promise<Jobsite[]> {
  const { rows } = await db.query<JobsiteRow>(
    `SELECT ${COLUMNS} FROM jobsites WHERE user_id = $1
      ORDER BY is_default DESC, last_used_at DESC NULLS LAST, created_at DESC, id`,
    [userId],
  );
  return rows.map(toJobsite);
}

export async function findJobsite(db: Queryable, id: string): Promise<(Jobsite & { userId: string }) | null> {
  const { rows } = await db.query<JobsiteRow>(`SELECT ${COLUMNS} FROM jobsites WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? { ...toJobsite(row), userId: row.user_id } : null;
}

/** Statement (n), first line: the owner's row lock (rank 1) guards the user's jobsites and cards. */
export async function lockOwner(tx: Tx, userId: string): Promise<void> {
  await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);
}

export async function countJobsites(tx: Tx, userId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM jobsites WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.n ?? 0;
}

async function clearDefault(tx: Tx, userId: string, exceptId: string): Promise<void> {
  await tx.query(
    'UPDATE jobsites SET is_default = false, updated_at = $3 WHERE user_id = $1 AND is_default AND id <> $2',
    [userId, exceptId, new Date(tx.now)],
  );
}

/**
 * Create or replace one jobsite of the locked owner. `lastUsedAt` and `createdAt` are kept. Returns null when
 * the id belongs to another user (the caller answers `already-exists`).
 */
export async function upsertJobsite(
  tx: Tx,
  userId: string,
  id: string,
  fields: JobsiteFields,
  isDefault: boolean,
): Promise<Jobsite | null> {
  if (isDefault) await clearDefault(tx, userId, id);
  const { rows } = await tx.query<JobsiteRow>(
    `INSERT INTO jobsites (id, user_id, doc, is_default, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $5)
     ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, is_default = EXCLUDED.is_default, updated_at = EXCLUDED.updated_at
       WHERE jobsites.user_id = EXCLUDED.user_id
     RETURNING ${COLUMNS}`,
    [id, userId, JSON.stringify(fields), isDefault, new Date(tx.now)],
  );
  if (!rows[0]) return null;
  await ensureDefault(tx, userId);
  return reload(tx, id);
}

/** A user with jobsites always has exactly one default: the most recently used one when none is flagged. */
async function ensureDefault(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    `UPDATE jobsites SET is_default = true, updated_at = $2
      WHERE id = (SELECT id FROM jobsites WHERE user_id = $1
                   ORDER BY last_used_at DESC NULLS LAST, created_at DESC, id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM jobsites WHERE user_id = $1 AND is_default)`,
    [userId, new Date(tx.now)],
  );
}

async function reload(tx: Tx, id: string): Promise<Jobsite | null> {
  const { rows } = await tx.query<JobsiteRow>(`SELECT ${COLUMNS} FROM jobsites WHERE id = $1`, [id]);
  return rows[0] ? toJobsite(rows[0]) : null;
}

/** Deletes an own jobsite; when it was the default, the most recently used remaining one takes over. */
export async function deleteJobsite(tx: Tx, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await tx.query('DELETE FROM jobsites WHERE id = $1 AND user_id = $2', [id, userId]);
  if (rowCount === 0) return false;
  await ensureDefault(tx, userId);
  return true;
}

/** `placeOrder` is the only writer of `last_used_at`. */
export async function touchJobsite(tx: Tx, id: string): Promise<void> {
  await tx.query('UPDATE jobsites SET last_used_at = $2 WHERE id = $1', [id, new Date(tx.now)]);
}
