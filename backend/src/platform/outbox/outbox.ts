/** Enqueue a network side effect in the business transaction (statement (e) of §3.5). */
import type { Tx } from '../db/tx';
import type { OutboxEventName } from './registry';

export interface EnqueueOptions {
  /** Coalesces with a pending row of the same key. */
  dedupeKey?: string;
  runAt?: number;
  maxAttempts?: number;
  /** The payload is replaced by {} once the event is done (codes, links). */
  sensitive?: boolean;
}

/** Defaults of the table in §9.3. */
export const MAX_ATTEMPTS: Record<OutboxEventName, number> = {
  'push.send': 5,
  'sms.send': 5,
  'mail.send': 5,
  'payment.finalize': 12,
  'payment.refund': 12,
  'payment.void': 12,
  'payout.transfer': 12,
  'route.plan': 3,
  'tracking.eta': 2,
};

/** No transaction, no event: if the command rolls back, the side effect never existed. */
export async function enqueue(
  tx: Tx,
  event: OutboxEventName,
  payload: object,
  opts: EnqueueOptions = {},
): Promise<void> {
  const body = opts.sensitive ? { ...payload, __sensitive: true } : payload;
  await tx.query(
    `INSERT INTO outbox (event, payload, dedupe_key, max_attempts, run_at, created_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING`,
    [
      event,
      JSON.stringify(body),
      opts.dedupeKey ?? null,
      opts.maxAttempts ?? MAX_ATTEMPTS[event],
      new Date(opts.runAt ?? tx.now),
      new Date(tx.now),
    ],
  );
  await tx.query(`SELECT pg_notify('is_outbox', '')`);
}
