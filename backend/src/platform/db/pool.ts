import pg from 'pg';
import type { Logger } from 'pino';
import type { Config } from '../../config/env';

// bigint (cents, identity ids) → number. Every value we store fits in 2^53 − 1; a larger one is a bug and
// must not be rounded silently.
pg.types.setTypeParser(pg.types.builtins.INT8, (text: string) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(`bigint out of range: ${text}`);
  return value;
});
// timestamptz → epoch milliseconds (P3). The built-in parser returns a Date.
const parseTimestampTz = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ) as (text: string) => Date;
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (text: string) => parseTimestampTz(text).getTime());

export function poolOptions(config: Config, overrides: pg.PoolConfig = {}): pg.PoolConfig {
  return {
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'instasupply-api',
    statement_timeout: 15_000,
    lock_timeout: 8_000,
    idle_in_transaction_session_timeout: 30_000,
    // The development server on this machine runs in Asia/Kolkata; nothing may depend on the server's zone.
    options: '-c TimeZone=UTC',
    ...overrides,
  };
}

export function createPool(config: Config, log: Logger, overrides: pg.PoolConfig = {}): pg.Pool {
  const pool = new pg.Pool(poolOptions(config, overrides));
  // Without a listener an idle client that loses its connection crashes the process (§13).
  pool.on('error', (error) => log.error({ err: error }, 'idle database client failed'));
  return pool;
}
