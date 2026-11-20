/**
 * captureDuePayments (docs/PLATFORM.md §9.5; MARKETPLACE §3.8 "Deadline sweep"), every 30 minutes: (1) retry
 * `capture_failed`, (2) recover a `capture_pending` stuck for 10 minutes, (3) capture what is still `authorized`
 * at its deadline, (4) void journal rows that no order owns after 15 minutes. It only enqueues; the handlers
 * do the work and re-check everything under their own locks.
 */
import type { Deps } from '../../container';
import { withTransaction } from '../../platform/db/tx';
import { enqueue } from '../../platform/outbox/outbox';
import { dueOrders, orphanJournals } from './repository';

const ORPHAN_AFTER_MS = 15 * 60_000;

async function each(
  deps: Deps,
  next: (afterId: string | null) => Promise<string[]>,
  run: (id: string) => Promise<void>,
): Promise<number> {
  let count = 0;
  let afterId: string | null = null;
  for (;;) {
    const ids = await next(afterId);
    if (ids.length === 0) return count;
    for (const id of ids) {
      try {
        await run(id);
        count += 1;
      } catch (error) {
        deps.log.error({ err: error, orderId: id }, 'captureDuePayments: one row failed');
      }
    }
    afterId = ids[ids.length - 1]!;
  }
}

export async function runCaptureDuePayments(deps: Deps, now: number): Promise<Record<string, number>> {
  const finalize = (deadline: boolean) => (orderId: string) =>
    withTransaction(
      deps,
      (tx) =>
        enqueue(tx, 'payment.finalize', { orderId, deadline }, { dedupeKey: `payment.finalize:${orderId}` }),
      { now },
    );
  const retried = await each(
    deps,
    (after) => dueOrders(deps.pool, 'capture_failed', now, after),
    finalize(false),
  );
  const recovered = await each(
    deps,
    (after) => dueOrders(deps.pool, 'capture_pending', now, after),
    finalize(false),
  );
  const deadlineCaptured = await each(
    deps,
    (after) => dueOrders(deps.pool, 'deadline', now, after),
    finalize(true),
  );
  const orphansVoided = await each(
    deps,
    (after) => orphanJournals(deps.pool, now - ORPHAN_AFTER_MS, after),
    (orderId) =>
      withTransaction(
        deps,
        (tx) => enqueue(tx, 'payment.void', { orderId }, { dedupeKey: `payment.void:${orderId}` }),
        { now },
      ),
  );
  return { retried, recovered, deadlineCaptured, orphansVoided };
}
