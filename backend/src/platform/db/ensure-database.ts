import pg from 'pg';
import type { Config } from '../../config/env';
import { poolOptions } from './pool';

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** The database named by a connection string. */
export function databaseName(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
  if (!NAME.test(name)) throw new Error(`database name "${name}" must match ${NAME}`);
  return name;
}

/** The same server, the maintenance database `postgres`. */
export function maintenanceUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

/**
 * Creates the development database when it is missing (§2.6 step 2). Only for DATABASE_AUTO_CREATE=true,
 * which production refuses. Returns true when it created the database.
 */
export async function ensureDatabase(config: Config): Promise<boolean> {
  const name = databaseName(config.DATABASE_URL);
  const client = new pg.Client({
    ...poolOptions(config),
    connectionString: maintenanceUrl(config.DATABASE_URL),
  });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount) return false;
    try {
      // The name was checked against NAME, so quoting it is enough.
      await client.query(`CREATE DATABASE "${name}"`);
    } catch (error) {
      // Two processes starting together: the other one created it first.
      if ((error as { code?: string }).code !== '42P04') throw error;
      return false;
    }
    return true;
  } finally {
    await client.end();
  }
}
