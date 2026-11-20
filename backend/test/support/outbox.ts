/** The outbox in tests (docs/PLATFORM.md §12.2): nothing runs by itself, a test drains when it wants to. */
import type { TestContext } from './database';

type Ctx = Pick<TestContext, 'pool' | 'drainOutbox'>;

export interface OutboxRow {
  id: number;
  event: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number;
  lastError: string | null;
}

/** Handles every event due at the fake clock, including events the handlers enqueue; returns the count. */
export function drainOutbox(ctx: Ctx): Promise<number> {
  return ctx.drainOutbox();
}

/** What was enqueued, oldest first; filtered by event name and status when given. */
export async function outboxEvents(
  ctx: Ctx,
  event?: string,
  status?: OutboxRow['status'],
): Promise<OutboxRow[]> {
  const { rows } = await ctx.pool.query<OutboxRow>(
    `SELECT id::int AS id, event, payload, dedupe_key AS "dedupeKey", status, attempts, last_error AS "lastError"
       FROM outbox
      WHERE ($1::text IS NULL OR event = $1) AND ($2::text IS NULL OR status = $2)
      ORDER BY id`,
    [event ?? null, status ?? null],
  );
  return rows;
}

export interface DevOutboxRow {
  channel: 'sms' | 'email';
  to: string;
  subject: string | null;
  body: string | null;
  purpose: string;
  status: string;
  sensitive: boolean;
}

/** The SMS and email the outbox drivers stored (dev_outbox), oldest first. */
export async function sentMessages(ctx: Ctx, channel?: 'sms' | 'email'): Promise<DevOutboxRow[]> {
  const { rows } = await ctx.pool.query<DevOutboxRow>(
    `SELECT channel, to_address AS "to", subject, body, purpose, status, sensitive
       FROM dev_outbox WHERE ($1::text IS NULL OR channel = $1) ORDER BY created_at, id`,
    [channel ?? null],
  );
  return rows;
}
