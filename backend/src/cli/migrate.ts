/**
 * `migrate [--status]` (docs/PLATFORM.md §2.6): apply pending migrations, then upsert the reference data.
 * This is the Railway pre-deploy command; exit code 1 stops the deployment.
 */
import { CATEGORIES } from '@instasupply/shared';
import type pg from 'pg';
import type { Config } from '../config/env';
import { createPool } from '../platform/db/pool';
import { migrate, status } from '../platform/migrations/migrator';
import { migrationsDir } from '../platform/paths';
import { createLogger } from '../container';

/**
 * Inserts the categories of CATEGORIES that are missing. Existing rows are left alone, so staff edits
 * survive every deployment.
 */
export async function syncReferenceData(pool: Pick<pg.Pool, 'query'>, now: number): Promise<number> {
  let inserted = 0;
  for (const category of Object.values(CATEGORIES)) {
    const { id, ...doc } = category;
    const result = await pool.query(
      `INSERT INTO categories (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3) ON CONFLICT (id) DO NOTHING`,
      [id, JSON.stringify(doc), new Date(now)],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function runMigrate(config: Config, args: string[]): Promise<number> {
  const log = createLogger(config);
  const pool = createPool(config, log);
  try {
    if (args.includes('--status')) {
      const state = await status(pool, migrationsDir());
      for (const row of state.applied)
        console.info(`applied  ${String(row.version).padStart(4, '0')}_${row.name}`);
      for (const row of state.pending)
        console.info(`pending  ${String(row.version).padStart(4, '0')}_${row.name}`);
      return 0;
    }
    const applied = await migrate(pool, migrationsDir(), (message) => console.info(message));
    const categories = await syncReferenceData(pool, Date.now());
    console.info(
      `migrations: ${applied.length === 0 ? 'nothing pending' : `${applied.length} applied`}; categories inserted: ${categories}`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await pool.end();
  }
}
