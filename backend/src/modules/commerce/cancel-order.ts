/**
 * cancelOrder (docs/PLATFORM.md §9.2.3; MARKETPLACE §5.4 row). Locks users(customer, drivers) → orders →
 * store_orders(targets) → deliveries → job_offers → products. Every target a customer may still cancel (`new`,
 * `accepted`) goes through the cancel row of §9.2.2 with `cancelledBy: 'customer'`; the others are reported.
 * One projectOrderAggregate at the end.
 */
import {
  canStoreOrderTransition,
  voidAmounts,
  type CancelOrderRequest,
  type CancelOrderResponse,
  type Delivery,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph, type DeliveryRow } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { applyDeliveryEffects, stageDeliveryCancellation } from '../deliveries';
import {
  applyStoreOrderEffects,
  orderActorFrom,
  stageStockRelease,
  stageStoreOrderTransition,
  toStoreOrder,
} from '../store-orders';
import { projectOrderAggregate } from './order-aggregate';
import { findOrderCustomer, listStoreOrdersOfOrder } from './orders.repository';

const asDelivery = (row: DeliveryRow): Delivery =>
  ({ ...row.doc, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }) as unknown as Delivery;

const DONE_DELIVERY = new Set(['cancelled', 'delivered', 'failed']);

export async function cancelOrder(
  deps: Deps,
  actor: Actor,
  req: CancelOrderRequest,
): Promise<CancelOrderResponse> {
  const customerId = await findOrderCustomer(deps.pool, req.orderId);
  if (!customerId) notFound('That order does not exist.');
  if (customerId !== actor.uid) permissionDenied();

  const all = await listStoreOrdersOfOrder(deps.pool, req.orderId);
  const known = new Set(all.map((so) => so.id));
  const targets = [...new Set(req.storeOrderIds ?? all.map((so) => so.id))].sort();
  const unknown = targets.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    invalidArgument('A store order does not belong to this order.', {
      fields: { storeOrderIds: unknown.join(',') },
    });
  }
  const productIds = [
    ...new Set(
      all
        .filter((so) => targets.includes(so.id))
        .flatMap((so) => so.lines)
        .flatMap((line) => (line.kind === 'catalog' && line.productId ? [line.productId] : [])),
    ),
  ];
  const reason = req.reason ?? 'Cancelled by the customer';
  const who = { uid: actor.uid, name: actor.name, role: 'customer' as const };

  return withTransaction(deps, async (tx) => {
    const graph = await lockGraph(tx, {
      orderIds: [req.orderId],
      storeOrderIds: targets,
      productIds,
      withOffers: true,
    });
    const cancelled: string[] = [];
    const notCancellable: CancelOrderResponse['notCancellable'] = [];
    let changed = false;

    for (const id of targets) {
      const row = graph.storeOrders.get(id);
      if (!row) continue;
      const before = toStoreOrder(row);
      if (before.status === 'cancelled') {
        cancelled.push(id);
        continue;
      }
      if (
        !canStoreOrderTransition(before.status, 'cancelled', 'customer', { fulfilment: before.fulfilment })
      ) {
        notCancellable.push({ storeOrderId: id, status: before.status });
        continue;
      }

      const release = before.lines.flatMap((line) =>
        line.kind === 'catalog' && line.productId && line.fulfilledQty > 0
          ? [{ productId: line.productId, quantity: line.fulfilledQty }]
          : [],
      );
      if (release.length > 0) await stageStockRelease(tx, release, { outOfStock: false });

      let deliveryChange: { before: Delivery; after: Delivery } | null = null;
      const deliveryRow = before.deliveryId ? graph.deliveries.get(before.deliveryId) : undefined;
      if (deliveryRow && !DONE_DELIVERY.has(deliveryRow.status)) {
        const deliveryBefore = asDelivery(deliveryRow);
        const deliveryAfter = await stageDeliveryCancellation(tx, graph, deliveryBefore, who, reason);
        deliveryChange = { before: deliveryBefore, after: deliveryAfter };
      }

      const after = await stageStoreOrderTransition(tx, graph, before, 'cancelled', orderActorFrom(actor), {
        reason,
        extra: { current: voidAmounts(), cancelReason: reason, cancelledBy: 'customer' },
      });
      await applyStoreOrderEffects(tx, graph, before, after);
      if (deliveryChange) await applyDeliveryEffects(tx, graph, deliveryChange.before, deliveryChange.after);
      cancelled.push(id);
      changed = true;
    }

    if (cancelled.length === 0) {
      failedPrecondition('These items can no longer be cancelled: the store has started preparing them.', {
        notCancellable,
      });
    }
    if (changed) await projectOrderAggregate(tx, graph, req.orderId);
    return { cancelled, notCancellable };
  });
}
