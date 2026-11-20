/**
 * `npm run db -- reset | status` (docs/PLATFORM.md §2.2): development only, against the local PostgreSQL 17
 * (no Docker). `reset` drops and recreates the database of DATABASE_URL and applies the migrations;
 * `status` prints which migrations are applied and pending.
 */
import pg from 'pg';
import { syncReferenceData } from '../src/cli/migrate';
import { loadConfig } from '../src/config/env';
import { databaseName, maintenanceUrl } from '../src/platform/db/ensure-database';
import { migrate, status } from '../src/platform/migrations/migrator';
import { migrationsDir } from '../src/platform/paths';

async function main(command: string | undefined): Promise<number> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    console.error('db is a development tool; it refuses NODE_ENV=production.');
    return 1;
  }
  const name = databaseName(config.DATABASE_URL);
  if (command === 'reset') {
    if (!name.startsWith('instasupply_')) {
      console.error(`refusing to drop "${name}": only databases named instasupply_* are reset.`);
      return 1;
    }
    const admin = new pg.Client({ connectionString: maintenanceUrl(config.DATABASE_URL) });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    try {
      const applied = await migrate(pool, migrationsDir(), (message) => console.log(message));
      const categories = await syncReferenceData(pool, Date.now());
      console.log(`reset ${name}: ${applied.length} migration(s) applied, ${categories} categories inserted`);
    } finally {
      await pool.end();
    }
    return 0;
  }
  if (command === 'status') {
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 1 });
    try {
      const state = await status(pool, migrationsDir());
      console.log(`database ${name}`);
      for (const row of state.applied) {
        console.log(
          `  applied  ${String(row.version).padStart(4, '0')}_${row.name}  ${new Date(row.appliedAt).toISOString()}`,
        );
      }
      for (const row of state.pending)
        console.log(`  pending  ${String(row.version).padStart(4, '0')}_${row.name}`);
      if (state.applied.length + state.pending.length === 0) console.log('  no migration files');
    } catch (error) {
      console.error(`cannot read ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      await pool.end();
    }
    return 0;
  }
  console.error('usage: npm run db -- reset | status');
  return 1;
}

main(process.argv[2]).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
