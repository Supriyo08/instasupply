/**
 * Publishing live events (docs/PLATFORM.md §8.3). `pg_notify` runs on the transaction's connection, so
 * PostgreSQL delivers the event only if and when the transaction commits, in publication order.
 */
import type { Tx } from '../db/tx';
import type { ControlMessage, EventKind, LiveNotification } from './protocol';
import { topicsFor, type LiveTable } from './topics';

export const LIVE_CHANNEL = 'is_live';
/** NOTIFY payloads must stay under 8000 bytes; a larger event is sent without `data` (clients refetch). */
export const MAX_NOTIFY_BYTES = 7500;

type Notifier = Pick<Tx, 'query'>;

export function serializeNotification(event: LiveNotification): string {
  const text = JSON.stringify(event);
  if (Buffer.byteLength(text) <= MAX_NOTIFY_BYTES) return text;
  return JSON.stringify({ ...event, data: null });
}

/** Statement (k) of §3.5 inside the business transaction. */
export async function publish(
  tx: Notifier,
  event: Omit<LiveNotification, 'at'> & { at?: number },
): Promise<void> {
  const at = event.at ?? ('now' in tx && typeof tx.now === 'number' ? tx.now : Date.now());
  await tx.query('SELECT pg_notify($1, $2)', [LIVE_CHANNEL, serializeNotification({ ...event, at })]);
}

/** Outside a transaction (POST /me/location): the same statement on the pool, delivered at once. */
export async function publishNow(
  pool: Notifier,
  event: Omit<LiveNotification, 'at'> & { at: number },
): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [LIVE_CHANNEL, serializeNotification(event)]);
}

/**
 * The one way repositories announce a written row: the topic table of §8.2 picks the topics, one
 * notification per frame shape (a message is `message` with data on its thread and `updated` on ops:).
 */
export async function publishChange(
  tx: Notifier & { now?: number },
  table: LiveTable,
  kind: Exclude<EventKind, 'message'>,
  row: object,
): Promise<void> {
  const at = typeof tx.now === 'number' ? tx.now : Date.now();
  for (const frame of topicsFor(table, kind, row as Record<string, unknown>)) {
    if (frame.topics.length === 0) continue;
    await publish(tx, { ...frame, at, data: frame.data ?? null });
  }
}

/** drop_user / drop_session: every instance closes the matching sockets with 4403. */
export async function publishControl(tx: Notifier, message: ControlMessage): Promise<void> {
  await tx.query('SELECT pg_notify($1, $2)', [LIVE_CHANNEL, JSON.stringify(message)]);
}
