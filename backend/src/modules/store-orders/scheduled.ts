/**
 * The store-order jobs of MARKETPLACE §5.7 (docs/PLATFORM.md §9.5). Each body selects candidate ids with an
 * indexed query (LIMIT 200, repeated until none is left), then handles each row in its own transaction with
 * lockGraph, re-checking the condition under lock. A row that throws is logged, counted under `errors` and not
 * tried again in this run; the others continue.
 */
import { shortStoreName, type StoreOrder } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { LockedGraph } from '../../platform/db/locks';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { enqueue } from '../../platform/outbox/outbox';
import { projectOrderAggregate } from '../commerce/order-aggregate';
import { notifyStaff, notifyStoreMembers } from '../notifications/notify';
import { SYSTEM_ORDER_ACTOR } from './access';
import { lockStoreOrder } from './command-support';
import { stageStoreOrderVoid } from './store-order-void';
import {
  autoRejectCandidates,
  expiredHoldCandidates,
  loadStoreOrderKeys,
  overdueCandidates,
  readStoreInfo,
  reminderCandidates,
  saveStoreOrder,
} from './store-orders.repository';
import { refreshGraph } from './transitions';

const MINUTE_MS = 60_000;

type Candidates = (deps: Deps, now: number, skip: readonly string[]) => Promise<string[]>;
/** True when the row was changed, false when the condition no longer held under lock. */
type PerRow = (tx: Tx, graph: LockedGraph, so: StoreOrder, now: number) => Promise<boolean>;

async function sweep(
  deps: Deps,
  job: string,
  now: number,
  candidates: Candidates,
  perRow: PerRow,
): Promise<{ done: number; errors: number }> {
  const seen: string[] = [];
  let done = 0;
  let errors = 0;
  for (;;) {
    const ids = await candidates(deps, now, seen);
    if (ids.length === 0) break;
    for (const id of ids) {
      seen.push(id);
      try {
        const keys = await loadStoreOrderKeys(deps.pool, id);
        if (!keys) continue;
        const changed = await withTransaction(
          deps,
          async (tx) => {
            const { graph, so } = await lockStoreOrder(tx, keys);
            return perRow(tx, graph, so, now);
          },
          { now },
        );
        if (changed) done += 1;
      } catch (error) {
        errors += 1;
        deps.log.error({ err: error, job, storeOrderId: id }, 'store-order job row failed');
      }
    }
  }
  return { done, errors };
}

// ---------- escalateStoreOrders ----------

const remind: PerRow = async (tx, graph, so, now) => {
  if (so.status !== 'new' || so.reminderSentAt !== null) return false;
  if (so.timing.respondBy - 5 * MINUTE_MS > now) return false;
  const saved = await saveStoreOrder(tx, { ...so, reminderSentAt: now });
  refreshGraph(graph, saved);
  await notifyStoreMembers(tx, so.storeId, {
    type: 'store_order_reminder',
    title: `${so.number} is waiting`,
    body: `${so.number} is waiting. Accept or reject in InstaSupply.`,
    data: { storeOrderId: so.id },
    key: `so-reminder-${so.id}`,
  });
  const { alertPhone } = await readStoreInfo(tx, so.storeId);
  if (alertPhone) {
    // reminderSentAt is the marker, written in this transaction: the SMS exists once (§9.3).
    await enqueue(tx, 'sms.send', {
      to: alertPhone,
      body: `InstaSupply: ${so.number} is waiting. Accept or reject in InstaSupply.`,
      purpose: 'store_alert',
      sensitive: false,
    });
  }
  return true;
};

const flagOverdue: PerRow = async (tx, graph, so, now) => {
  if (so.status !== 'new' || so.acceptOverdue || so.timing.respondBy > now) return false;
  const saved = await saveStoreOrder(tx, { ...so, acceptOverdue: true });
  refreshGraph(graph, saved);
  const minutes = Math.max(1, Math.round((now - so.createdAt) / MINUTE_MS));
  await notifyStaff(tx, {
    type: 'store_order_late',
    title: `${so.number} not accepted`,
    body: `${so.number} not accepted after ${minutes} min (${shortStoreName(so.storeName)})`,
    data: { customerOrderId: so.orderId, storeOrderId: so.id },
    key: `so-late-${so.id}`,
  });
  await projectOrderAggregate(tx, graph, so.orderId); // needsAttention
  return true;
};

const autoReject: PerRow = async (tx, graph, so, now) => {
  if (so.status !== 'new' || so.timing.respondBy + 20 * MINUTE_MS > now) return false;
  await stageStoreOrderVoid(tx, graph, so, SYSTEM_ORDER_ACTOR, { to: 'rejected', reason: 'no_response' });
  return true;
};

export async function escalateStoreOrders(deps: Deps, now: number): Promise<Record<string, number>> {
  const reminded = await sweep(
    deps,
    'escalateStoreOrders',
    now,
    (d, n, s) => reminderCandidates(d.pool, n, s),
    remind,
  );
  const overdue = await sweep(
    deps,
    'escalateStoreOrders',
    now,
    (d, n, s) => overdueCandidates(d.pool, n, s),
    flagOverdue,
  );
  const rejected = await sweep(
    deps,
    'escalateStoreOrders',
    now,
    (d, n, s) => autoRejectCandidates(d.pool, n, s),
    autoReject,
  );
  return {
    reminded: reminded.done,
    overdue: overdue.done,
    rejected: rejected.done,
    errors: reminded.errors + overdue.errors + rejected.errors,
  };
}

// ---------- expirePickupHolds ----------

const expireHold: PerRow = async (tx, graph, so, now) => {
  if (so.fulfilment !== 'pickup' || so.status !== 'ready') return false;
  if (so.pickup.holdUntil === null || so.pickup.holdUntil > now) return false;
  await stageStoreOrderVoid(tx, graph, so, SYSTEM_ORDER_ACTOR, {
    to: 'cancelled',
    reason: null,
    cancelReason: 'Not collected before the hold expired',
  });
  return true;
};

export async function expirePickupHolds(deps: Deps, now: number): Promise<Record<string, number>> {
  const expired = await sweep(
    deps,
    'expirePickupHolds',
    now,
    (d, n, s) => expiredHoldCandidates(d.pool, n, s),
    expireHold,
  );
  return { expired: expired.done, errors: expired.errors };
}
