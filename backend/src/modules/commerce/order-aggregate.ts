/**
 * projectOrderAggregate (docs/PLATFORM.md §9.2.12; MARKETPLACE §5.5.5, was syncOrderAggregate): the order is a
 * projection of its store orders. Called inside every transaction that changes a store order, with
 * users(customer) and the order locked; it recomputes everything from the current rows, so a second call is
 * harmless. The payment side effects it triggers (finalize, the replacement ledger, automatic refunds) are
 * decided here, in the same transaction.
 */
import {
  isFinalStoreOrderStatus,
  orderNeedsAttention,
  orderStatusFromStoreOrders,
  sumAmounts,
  type Order,
  type StoreOrder,
  type StoreOrderSummary,
} from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import { lockRows } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { enqueue } from '../../platform/outbox/outbox';
import { recordStoreOrderLedger } from '../payouts/ledger';
import {
  findOrder,
  listStoreOrdersOfOrder,
  lockCustomer,
  patchCustomerDoc,
  refundsInFlight,
  saveOrder,
} from './orders.repository';

/** A store order as the order lists it; the token and the customer's PIN are carried over (never on the store order). */
export function summaryOf(
  so: StoreOrder,
  previous: Pick<StoreOrderSummary, 'trackingToken' | 'pickupCode'> | null,
): StoreOrderSummary {
  return {
    storeOrderId: so.id,
    number: so.number,
    letter: so.letter,
    storeId: so.storeId,
    storeName: so.storeName,
    fulfilment: so.fulfilment,
    status: so.status,
    itemCount: so.itemCount,
    itemsSummary: so.itemsSummary,
    currentTotalCents: so.current.totalCents,
    deliverBy: so.timing.deliverBy,
    readyAt: so.pickup.readyAt,
    holdUntil: so.pickup.holdUntil,
    trackingToken: previous?.trackingToken ?? null,
    pickupCode: previous?.pickupCode ?? null,
    driverFirstName: so.driver?.firstName ?? null,
    updatedAt: so.updatedAt,
  };
}

/** The promo whose use the order counts, when one was applied at placement. */
const appliedPromo = (order: Order): string | null =>
  order.placed.discounts.find((discount) => discount.kind === 'promo')?.code ?? null;

/**
 * Was syncOrderAggregate (MARKETPLACE §5.5.5); called inside every transaction that changes a store order.
 * The caller holds users(customer) and the order (§3.6 rule 1); a row the graph lacks is locked here.
 */
export async function projectOrderAggregate(tx: Tx, graph: LockedGraph, orderId: string): Promise<Order> {
  if (!graph.orders.has(orderId)) {
    const { rows } = await tx.query<{ customer_id: string }>('SELECT customer_id FROM orders WHERE id = $1', [
      orderId,
    ]);
    const customerId = rows[0]?.customer_id;
    if (customerId && !graph.users.has(customerId)) await lockRows(tx, 'users', [customerId]);
    await lockRows(tx, 'orders', [orderId]);
  }
  const before = await findOrder(tx, orderId);
  if (!before) throw new Error(`projectOrderAggregate: order ${orderId} does not exist`);
  const storeOrders = await listStoreOrdersOfOrder(tx, orderId);
  const now = tx.now;

  const previous = new Map(before.storeOrders.map((summary) => [summary.storeOrderId, summary]));
  const statuses = storeOrders.map((so) => so.status);
  const status = orderStatusFromStoreOrders(statuses);
  const statusAt = { ...before.statusAt };
  statusAt[status] ??= now;
  const completedNow = status === 'completed' && before.completedAt === null;
  const cancelledNow = status === 'cancelled' && before.countsTowardFirstOrder;

  let order: Order = {
    ...before,
    storeOrders: storeOrders.map((so) => summaryOf(so, previous.get(so.id) ?? null)),
    current: sumAmounts(storeOrders.map((so) => so.current)),
    status,
    statusAt,
    needsAttention: orderNeedsAttention(storeOrders),
    completedAt: completedNow ? now : before.completedAt,
    countsTowardFirstOrder: cancelledNow ? false : before.countsTowardFirstOrder,
    cancelReason:
      status === 'cancelled'
        ? (before.cancelReason ?? storeOrders.find((so) => so.cancelReason !== null)?.cancelReason ?? null)
        : before.cancelReason,
  };

  if (completedNow || cancelledNow) {
    const customer = await lockCustomer(tx, order.customerId);
    if (customer) {
      const stats = {
        nonCancelledOrders: customer.doc.stats?.nonCancelledOrders ?? 0,
        completedOrders: customer.doc.stats?.completedOrders ?? 0,
        lastOrderAt: customer.doc.stats?.lastOrderAt ?? null,
      };
      const patch: Record<string, unknown> = {};
      if (completedNow) stats.completedOrders += 1;
      if (cancelledNow) {
        // A cancelled first order must not use up the first-order perks (MARKETPLACE §1.3 countsTowardFirstOrder).
        stats.nonCancelledOrders = Math.max(0, stats.nonCancelledOrders - 1);
        const code = appliedPromo(order);
        if (code) {
          const uses = { ...(customer.doc.promoUses ?? {}) };
          uses[code] = Math.max(0, (uses[code] ?? 0) - 1);
          patch.promoUses = uses;
        }
      }
      patch.stats = stats;
      await patchCustomerDoc(tx, customer, patch);
    }
  }

  if (JSON.stringify({ ...order, updatedAt: 0 }) !== JSON.stringify({ ...before, updatedAt: 0 })) {
    order = await saveOrder(tx, order);
  }

  const settled = storeOrders.length > 0 && storeOrders.every((so) => isFinalStoreOrderStatus(so.status));
  const payment = order.payment.status;
  if (settled && payment === 'authorized') {
    await enqueue(
      tx,
      'payment.finalize',
      { orderId, deadline: false },
      { dedupeKey: `payment.finalize:${orderId}` },
    );
  }
  // A replacement settles without a charge; so does an order captured at its deadline before it settled.
  // The ledger ids are deterministic, so a repeated call writes nothing.
  if (settled && (payment === 'not_required' || payment === 'captured' || payment === 'partially_refunded')) {
    await recordStoreOrderLedger(tx, orderId);
  }
  if (payment === 'captured' || payment === 'partially_refunded')
    await checkAutomaticRefunds(tx, order, storeOrders);
  return order;
}

/**
 * The automatic refund of §9.2.12: per store order, what was captured for it minus what it costs now, minus
 * the automatic refunds already booked or still in the outbox. Only a positive difference is refunded, keyed by
 * the store order's version, so two changes before the handler runs refund once.
 */
export async function checkAutomaticRefunds(
  tx: Tx,
  order: Order,
  storeOrders?: readonly StoreOrder[],
): Promise<void> {
  const payment = order.payment;
  if (payment.status !== 'captured' && payment.status !== 'partially_refunded') return;
  const rows = storeOrders ?? (await listStoreOrdersOfOrder(tx, order.id));
  const inFlight = await refundsInFlight(
    tx,
    rows.map((so) => so.id),
  );
  for (const so of rows) {
    const captured = payment.capturedByStoreOrder[so.id] ?? 0;
    const adjusted = payment.adjustedByStoreOrder[so.id] ?? 0;
    const due = captured - so.current.totalCents - adjusted - (inFlight.get(so.id) ?? 0);
    if (due <= 0) continue;
    const idempotencyKey = `refund_adj_${so.id}_v${so.version}`;
    await enqueue(
      tx,
      'payment.refund',
      {
        orderId: order.id,
        storeOrderId: so.id,
        amountCents: due,
        reason: `${so.storeName} supplied less than was charged`,
        idempotencyKey,
        issueId: null,
      },
      { dedupeKey: `payment.refund:${idempotencyKey}` },
    );
  }
}
