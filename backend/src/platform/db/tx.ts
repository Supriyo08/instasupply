import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { ApiError } from '../http/errors';

export interface Tx {
  /** The command's clock value (§3.1). */
  readonly now: number;
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }>;
}

/** Anything that runs a query: the pool, a pool client, or a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Thrown inside a transaction to run it again from the start (a key changed under us, §3.6 rule 3). */
export class RetryTransaction extends Error {
  override readonly name = 'RetryTransaction';
}

export interface TxDeps {
  pool: pg.Pool;
  clock: { now(): number };
}

const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(['40P01', '40001']);

export function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/**
 * BEGIN, fn, COMMIT (or ROLLBACK). Deadlocks, serialization failures and RetryTransaction run fn again, at
 * most 3 times with jitter; fn must therefore have no effect outside the database. A lock wait past
 * lock_timeout means the database is busy, which the client may retry: `unavailable`.
 */
export async function withTransaction<T>(
  deps: TxDeps,
  fn: (tx: Tx) => Promise<T>,
  options: { now?: number } = {},
): Promise<T> {
  const now = options.now ?? deps.clock.now();
  for (let attempt = 1; ; attempt += 1) {
    const client = await connect(deps.pool);
    let released = false;
    try {
      await client.query('BEGIN');
      const tx: Tx = {
        now,
        query: async <R>(text: string, values?: unknown[]) => {
          const result = await client.query(text, values);
          return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
        },
      };
      const value = await fn(tx);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is broken; release it as broken so the pool discards it.
        client.release(true);
        released = true;
      }
      const code = pgCode(error);
      const retryable = error instanceof RetryTransaction || (code !== undefined && RETRYABLE.has(code));
      if (retryable && attempt < MAX_ATTEMPTS) {
        await sleep(20 + Math.floor(Math.random() * 80));
        continue;
      }
      if (retryable || code === '55P03') {
        throw new ApiError('unavailable', 'The service is busy. Please try again.', null, {
          retryAfterMs: 1000,
        });
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }
}

/** A pool checkout whose failure (database down) is reported as `unavailable`, not as a bug. */
export async function connect(pool: pg.Pool): Promise<pg.PoolClient> {
  try {
    return await pool.connect();
  } catch {
    throw new ApiError('unavailable', 'The service is temporarily unavailable. Please try again.', null, {
      retryAfterMs: 1000,
    });
  }
}
