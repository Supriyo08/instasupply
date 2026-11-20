import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { migrate, status } from '../../src/platform/migrations/migrator';
import { migrationsDir } from '../../src/platform/paths';
import { dropDatabase, newDatabaseName, urlFor } from './context';

describe('migrator (§2.6) and 0001_init.sql (§3.2)', () => {
  const name = newDatabaseName();
  let pool: pg.Pool;
  before(async () => {
    const admin = new pg.Client({ database: 'postgres' });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    pool = new pg.Pool({ connectionString: urlFor(name), max: 4 });
  });
  after(async () => {
    await pool.end();
    await dropDatabase(name);
  });

  test('two concurrent migrate() calls apply each file once', async () => {
    const [a, b] = await Promise.all([migrate(pool, migrationsDir()), migrate(pool, migrationsDir())]);
    assert.deepEqual([...a, ...b], [1]);
  });

  test('the schema has 40 tables, 148 indexes and the 3 number sequences', async () => {
    const { rows } = await pool.query<{ tables: number; indexes: number; sequences: number }>(
      `SELECT
         (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations') AS tables,
         (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'schema_migrations') AS indexes,
         (SELECT count(*)::int FROM pg_class WHERE relkind = 'S' AND relname IN
            ('order_number_seq', 'quote_number_seq', 'issue_number_seq')) AS sequences`,
    );
    assert.deepEqual(rows[0], { tables: 40, indexes: 148, sequences: 3 });
  });

  test('a second run does nothing and status lists the applied file', async () => {
    assert.deepEqual(await migrate(pool, migrationsDir()), []);
    const state = await status(pool, migrationsDir());
    assert.deepEqual(
      state.applied.map((m) => m.version),
      [1],
    );
    assert.deepEqual(state.pending, []);
  });

  test('a mirror column cannot be written (428C9)', async () => {
    await assert.rejects(
      pool.query(`UPDATE store_orders SET status = 'accepted'`),
      (error: { code?: string }) => error.code === '428C9',
    );
  });

  test('a changed applied file is refused, naming the file; a new file is applied', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'instasupply-migrations-'));
    try {
      await cp(migrationsDir(), dir, { recursive: true });
      await writeFile(
        path.join(dir, '0002_extra.sql'),
        'CREATE TABLE extra_probe (id integer PRIMARY KEY);\n',
      );
      assert.deepEqual(await migrate(pool, dir), [2]);
      await appendFile(path.join(dir, '0001_init.sql'), '\n-- edited\n');
      await assert.rejects(migrate(pool, dir), /0001_init\.sql was changed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await pool.query('DROP TABLE IF EXISTS extra_probe');
      await pool.query('DELETE FROM schema_migrations WHERE version = 2');
    }
  });
});
