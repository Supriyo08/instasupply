/** Every SQL statement on `files` (docs/PLATFORM.md §10.1). */
import type { UploadPurpose } from '@instasupply/shared';
import type { Queryable } from '../db/tx';

type Db = Queryable;

export interface FileRow {
  id: string;
  path: string;
  upload_key: string;
  purpose: UploadPurpose;
  uploaded_by: string;
  scope_id: string;
  content_type: string;
  size_bytes: number | null;
  max_bytes: number;
  original_name: string | null;
  status: 'pending' | 'ready';
  created_at: number;
  completed_at: number | null;
}

const COLUMNS = `id, path, upload_key, purpose, uploaded_by, scope_id, content_type, size_bytes, max_bytes,
  original_name, status, created_at, completed_at`;

export async function insertFile(
  db: Db,
  row: Omit<FileRow, 'size_bytes' | 'completed_at' | 'status'>,
): Promise<void> {
  await db.query(
    `INSERT INTO files (id, path, upload_key, purpose, uploaded_by, scope_id, content_type, max_bytes, original_name,
                        status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
    [
      row.id,
      row.path,
      row.upload_key,
      row.purpose,
      row.uploaded_by,
      row.scope_id,
      row.content_type,
      row.max_bytes,
      row.original_name,
      new Date(row.created_at),
    ],
  );
}

export async function findFileById(db: Db, id: string): Promise<FileRow | null> {
  const { rows } = await db.query<FileRow>(`SELECT ${COLUMNS} FROM files WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findFileByPath(db: Db, path: string): Promise<FileRow | null> {
  const { rows } = await db.query<FileRow>(`SELECT ${COLUMNS} FROM files WHERE path = $1`, [path]);
  return rows[0] ?? null;
}

/** Uploads of one scope (files_scope_idx); `since` limits the count to one day for the per-day caps. */
export async function countScopeFiles(
  db: Db,
  purpose: UploadPurpose,
  scopeId: string,
  since: number | null,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM files WHERE purpose = $1 AND scope_id = $2 AND ($3::timestamptz IS NULL OR created_at >= $3)`,
    [purpose, scopeId, since === null ? null : new Date(since)],
  );
  return rows[0]?.n ?? 0;
}

export async function markFileReady(db: Db, id: string, sizeBytes: number, now: number): Promise<void> {
  await db.query(
    `UPDATE files SET status = 'ready', size_bytes = $2, completed_at = $3 WHERE id = $1 AND status = 'pending'`,
    [id, sizeBytes, new Date(now)],
  );
}

export async function pendingFilesOlderThan(db: Db, before: number, limit: number): Promise<FileRow[]> {
  const { rows } = await db.query<FileRow>(
    `SELECT ${COLUMNS} FROM files WHERE status = 'pending' AND created_at < $1 ORDER BY created_at LIMIT $2`,
    [new Date(before), limit],
  );
  return rows;
}

export async function deleteFileRow(db: Db, id: string): Promise<void> {
  await db.query(`DELETE FROM files WHERE id = $1 AND status = 'pending'`, [id]);
}
