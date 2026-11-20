/**
 * Creating and dropping throwaway databases (docs/PLATFORM.md §12.1). Shared by the runner (template, sweep,
 * final drop) and by createTestContext (one clone per test file). The server is the one the libpq
 * variables PGHOST, PGPORT, PGUSER and PGPASSWORD name; unset means the local default socket and OS user.
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { syncReferenceData } from '../../src/cli/migrate';
import { migrate } from '../../src/platform/migrations/migrator';
import { migrationsDir } from '../../src/platform/paths';
import { REFERENCE_TIME } from './clock';

export const TEST_DB_PREFIX = 'instasupply_test_';
/** A crashed run's databases are dropped by the next run once they are this old. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const STAMP = /^instasupply_test_(\d{12})_/;

/** `YYYYMMDDHHMM` in UTC. */
export function stampOf(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

export function parseStamp(name: string): number | null {
  const match = STAMP.exec(name);
  if (!match?.[1]) return null;
  const s = match[1];
  const ms = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
  return Number.isNaN(ms) ? null : ms;
}

/** `instasupply_test_<stamp>_<rand>`: the TEST_RUN of one run; every database of the run starts with it. */
export function newRunName(now: number = Date.now()): string {
  return `${TEST_DB_PREFIX}${stampOf(now)}_${randomBytes(3).toString('hex')}`;
}

export const templateName = (run: string): string => `${run}_tpl`;

/** Only names we generate reach SQL, but quoting keeps a stray character from becoming SQL. */
const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export function urlFor(name: string): string {
  const host = process.env.PGHOST;
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ? encodeURIComponent(process.env.PGUSER) : '';
  const password = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : '';
  const auth = user ? `${user}${password}@` : '';
  // Without PGHOST node-postgres uses localhost, which is this machine's server; a socket directory in
  // PGHOST (a path) goes in the query string because it cannot be a URL host.
  if (host?.startsWith('/'))
    return `postgres://${auth}localhost:${port}/${name}?host=${encodeURIComponent(host)}`;
  return `postgres://${auth}${host ?? 'localhost'}:${port}/${name}`;
}

export async function withMaintenance<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ database: 'postgres', application_name: 'instasupply-test-admin' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * CREATE DATABASE, optionally from a template. 55006 ("source database is being accessed by other users")
 * happens while another file's clone or a late connection touches the template; it clears in moments.
 */
export async function createDatabase(name: string, template?: string): Promise<void> {
  const sql = `CREATE DATABASE ${ident(name)}${template ? ` TEMPLATE ${ident(template)}` : ''}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await withMaintenance((client) => client.query(sql));
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== '55006' || attempt >= 5) throw error;
      await sleep(100 * 2 ** attempt);
    }
  }
}

export async function dropDatabase(name: string): Promise<void> {
  await withMaintenance((client) => client.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`));
}

export async function listTestDatabases(): Promise<string[]> {
  return withMaintenance(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      // left() rather than LIKE: `_` is a LIKE wildcard.
      `SELECT datname FROM pg_database WHERE left(datname, $2) = $1 ORDER BY datname`,
      [TEST_DB_PREFIX, TEST_DB_PREFIX.length],
    );
    return rows.map((row) => row.datname);
  });
}

/** Drops every database whose name starts with `prefix` (the end of a run). Returns the names dropped. */
export async function dropDatabasesWithPrefix(prefix: string): Promise<string[]> {
  const names = (await listTestDatabases()).filter((name) => name.startsWith(prefix));
  // Clones before the template: a clone being dropped never blocks, but the order keeps logs readable.
  names.sort((a, b) => Number(a.endsWith('_tpl')) - Number(b.endsWith('_tpl')));
  for (const name of names) await dropDatabase(name);
  return names;
}

/** Left-overs of crashed runs: test databases whose stamp is older than STALE_AFTER_MS. */
export async function dropStaleDatabases(now: number = Date.now()): Promise<string[]> {
  const stale = (await listTestDatabases()).filter((name) => {
    const at = parseStamp(name);
    return at !== null && now - at > STALE_AFTER_MS;
  });
  for (const name of stale) await dropDatabase(name);
  return stale;
}

/** `…_<pid>_<n>`: a per-file database, named after the process that created it. */
const PER_PROCESS = /^instasupply_test_\d{12}_[0-9a-f]{6}_(\d+)_\d+$/;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as { code?: string }).code === 'EPERM';
  }
}

/** True when the libpq variables point at this machine, where the pids in database names are meaningful. */
export function serverIsLocal(): boolean {
  const host = process.env.PGHOST;
  return !host || host.startsWith('/') || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Per-file databases whose creating process is gone: a file killed by a signal or a crash never ran its
 * close(). This also catches files whose context does not prefix its databases with TEST_RUN. A live
 * process's database is never touched, so a concurrent run is safe; only meaningful on a local server.
 */
export async function dropOrphanedDatabases(): Promise<string[]> {
  if (!serverIsLocal()) return [];
  const orphans = (await listTestDatabases()).filter((name) => {
    const pid = Number(PER_PROCESS.exec(name)?.[1]);
    return Number.isInteger(pid) && pid > 0 && !processAlive(pid);
  });
  for (const name of orphans) await dropDatabase(name);
  return orphans;
}

/** Applies the migrations and the reference data (the 25 categories) to an empty database. */
export async function prepareDatabase(name: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: urlFor(name), max: 2 });
  pool.on('error', () => {});
  try {
    await migrate(pool, migrationsDir());
    await syncReferenceData(pool, REFERENCE_TIME);
  } finally {
    // Every connection must be gone, or cloning the template fails with 55006.
    await pool.end();
  }
}

/** Step 3 of §12.1: the migrated template every file of the run is cloned from. */
export async function createTemplate(run: string): Promise<string> {
  const name = templateName(run);
  await createDatabase(name);
  try {
    await prepareDatabase(name);
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    throw error;
  }
  return name;
}
