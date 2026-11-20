/**
 * The reject / cancel row of docs/PLATFORM.md §9.2.2, shared by `rejectStoreOrder`, the all-lines-short case
 * of `acceptStoreOrder` and `updateStoreOrderStatus`, and the jobs `escalateStoreOrders` (auto-reject) and
 * `expirePickupHolds`: `current` all zero, every remaining unit released (clamped for out_of_stock), the
 * delivery cancelled and its offer deleted, then the effects and the order aggregate. The caller holds the
 * graph: users → orders → store_orders → deliveries → job_offers → products.
 */
import type { LineAdjustment, StoreOrder, StoreRejectReason } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { projectOrderAggregate } from '../commerce/order-aggregate';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { stageDeliveryCancellation } from '../deliveries/delivery-writer';
import { REJECT_REASON_TEXT, applyStoreOrderEffects } from './store-order-effects';
import { stageStockRelease, stockLinesOf } from './stock';
import { toDelivery } from './store-orders.repository';
import { resolveActor, stageStoreOrderTransition, type OrderActor } from './transitions';

/** Deliveries that can still be called off: nothing has left the store. */
const CANCELLABLE_DELIVERY = new Set(['unassigned', 'assigned', 'accepted']);

export interface VoidOptions {
  to: 'rejected' | 'cancelled';
  /** Null for a cancellation that is no store's decision (a pickup hold that expired). */
  reason: StoreRejectReason | null;
  note?: string | null;
  adjustments?: LineAdjustment[];
  /** Free text for `cancelReason` (default: the reason's wording). */
  cancelReason?: string;
}

export async function stageStoreOrderVoid(
  tx: Tx,
  graph: LockedGraph,
  so: StoreOrder,
  actor: OrderActor,
  opts: VoidOptions,
): Promise<StoreOrder> {
  const reasonText = opts.reason ? REJECT_REASON_TEXT[opts.reason] : (opts.cancelReason ?? 'cancelled');
  const after = await stageStoreOrderTransition(tx, graph, so, opts.to, actor, {
    adjustments: opts.adjustments,
    reason: reasonText,
    note: opts.note ?? undefined,
    extra: {
      rejectReason: opts.reason ?? so.rejectReason,
      cancelReason: opts.to === 'cancelled' ? (opts.cancelReason ?? reasonText) : so.cancelReason,
    },
  });
  // What the store order still held (the shorted units were released by the transition).
  await stageStockRelease(tx, stockLinesOf(after.lines), { outOfStock: opts.reason === 'out_of_stock' });

  await applyStoreOrderEffects(tx, graph, so, after);

  const row = so.deliveryId ? graph.deliveries.get(so.deliveryId) : undefined;
  if (row) {
    const delivery = toDelivery(row);
    if (CANCELLABLE_DELIVERY.has(delivery.status)) {
      const who = resolveActor(actor);
      const cancelled = await stageDeliveryCancellation(
        tx,
        graph,
        delivery,
        { actorId: who.uid, actorName: who.name, actorRole: who.role, kind: who.kind },
        `${after.number} ${after.status === 'rejected' ? 'rejected' : 'cancelled'}: ${reasonText}`,
      );
      await applyDeliveryEffects(tx, graph, delivery, cancelled);
    }
  }

  await projectOrderAggregate(tx, graph, so.orderId);
  return after;
}
