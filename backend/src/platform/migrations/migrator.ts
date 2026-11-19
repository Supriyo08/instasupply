/**
 * Forward-only numbered SQL migrations (docs/PLATFORM.md §2.6). Each file runs in its own transaction
 * together with its schema_migrations row; an advisory lock makes two processes that start together apply
 * each file once; a changed applied file is refused, because a released migration is never edited.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { sha256Hex } from '../crypto';

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const NO_TRANSACTION = '-- migrate:no-transaction';

export interface MigrationFile {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  applied: { version: number; name: string; appliedAt: number }[];
  pending: { version: number; name: string }[];
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

export function readMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const match = FILE.exec(file);
    if (!match) throw new MigrationError(`migration file "${file}" must be named NNNN_name.sql`);
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const version = Number(match[1]);
    if (out.some((m) => m.version === version))
      throw new MigrationError(`two migrations share version ${version}`);
    out.push({ version, name: match[2]!, file, sql, checksum: sha256Hex(sql) });
  }
  return out;
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL)`;
const LOCK = `SELECT pg_advisory_lock(hashtextextended('instasupply:migrate', 0))`;
const UNLOCK = `SELECT pg_advisory_unlock(hashtextextended('instasupply:migrate', 0))`;

/** Applies every pending file. Returns the versions applied by this call. */
export async function migrate(
  pool: pg.Pool,
  dir: string,
  log: (message: string) => void = () => {},
): Promise<number[]> {
  const files = readMigrations(dir);
  const client = await pool.connect();
  const applied: number[] = [];
  try {
    // Migrations may legitimately run longer than the pool's statement timeout (an index on a big table).
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 0');
    await client.query(LOCK);
    try {
      await client.query(CREATE_TABLE);
      const { rows } = await client.query<{ version: number; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
      );
      const done = new Map(rows.map((row) => [row.version, row.checksum]));
      for (const migration of files) {
        const stored = done.get(migration.version);
        if (stored !== undefined) {
          if (stored !== migration.checksum) {
            throw new MigrationError(
              `${migration.file} was changed after it was applied (checksum mismatch)`,
            );
          }
          continue;
        }
        const record = [migration.version, migration.name, migration.checksum, new Date()];
        const insert =
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, $4)';
        if (migration.sql.startsWith(NO_TRANSACTION)) {
          await client.query(migration.sql);
          await client.query(insert, record);
        } else {
          await client.query('BEGIN');
          try {
            await client.query(migration.sql);
            await client.query(insert, record);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw new MigrationError(
              `${migration.file} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        applied.push(migration.version);
        log(`applied ${migration.file}`);
      }
    } finally {
      await client.query(UNLOCK);
    }
  } finally {
    // The session settings above must not leak into the pool.
    client.release(true);
  }
  return applied;
}

export async function status(pool: pg.Pool, dir: string): Promise<MigrationStatus> {
  const files = readMigrations(dir);
  const { rows: exists } = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`,
  );
  const rows = exists[0]?.present
    ? (
        await pool.query<{ version: number; name: string; applied_at: number }>(
          'SELECT version, name, applied_at FROM schema_migrations ORDER BY version',
        )
      ).rows
    : [];
  const appliedVersions = new Set(rows.map((row) => row.version));
  return {
    applied: rows.map((row) => ({ version: row.version, name: row.name, appliedAt: row.applied_at })),
    pending: files
      .filter((file) => !appliedVersions.has(file.version))
      .map((file) => ({ version: file.version, name: file.name })),
  };
}
