/**
 * `acceptStoreOrder` (MARKETPLACE §2.1, §2.1.1, §5.4 → docs/PLATFORM.md §9.2.2): `new → accepted`, optionally
 * with shortages. For a delivery the job offer is created (`scheduled` or `open`, MARKETPLACE §2.4), unless
 * dispatch already assigned a driver while the delivery was held. Shorting every line to 0 is a reject with
 * reason `out_of_stock`.
 */
import {
  canStoreOrderTransition,
  offerOpensAt,
  type AcceptStoreOrderRequest,
  type Delivery,
  type StoreOrderActionResponse,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import type { LockedGraph } from '../../platform/db/locks';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failedPrecondition } from '../../platform/http/errors';
import { projectOrderAggregate } from '../commerce/order-aggregate';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { stageJobOffer } from '../jobs/offers';
import { orderActorFrom } from './access';
import { checkVersion, keysForAction, lockStoreOrder, refreshDelivery } from './command-support';
import { applyStoreOrderEffects } from './store-order-effects';
import { stageStoreOrderVoid } from './store-order-void';
import { saveDelivery, toDelivery } from './store-orders.repository';
import {
  adjustmentsEmptyOrder,
  resolveActor,
  stageStoreOrderTransition,
  validateAdjustments,
} from './transitions';

export async function acceptStoreOrder(
  deps: Deps,
  actor: Actor,
  req: AcceptStoreOrderRequest,
): Promise<StoreOrderActionResponse> {
  const keys = await keysForAction(deps, actor, req.storeOrderId);
  const who = orderActorFrom(actor);
  return withTransaction(deps, async (tx) => {
    const { graph, so } = await lockStoreOrder(tx, keys);
    checkVersion(so, req.expectedVersion);
    validateAdjustments(so, req.adjustments);
    if (
      !canStoreOrderTransition(so.status, 'accepted', resolveActor(who).kind, { fulfilment: so.fulfilment })
    ) {
      failedPrecondition(`${so.number} is ${so.status} and can't be accepted any more.`, {
        status: so.status,
      });
    }
    if (adjustmentsEmptyOrder(so, req.adjustments)) {
      const voided = await stageStoreOrderVoid(tx, graph, so, who, {
        to: 'rejected',
        reason: 'out_of_stock',
        note: req.note ?? null,
        adjustments: req.adjustments,
      });
      return { status: voided.status, version: voided.version };
    }

    const after = await stageStoreOrderTransition(tx, graph, so, 'accepted', who, {
      adjustments: req.adjustments,
      note: req.note ?? undefined,
    });
    await applyStoreOrderEffects(tx, graph, so, after);
    if (so.deliveryId) await openJob(tx, graph, so.deliveryId, after.timing.targetPickupAt, actor.uid);
    await projectOrderAggregate(tx, graph, so.orderId);
    return { status: after.status, version: after.version };
  });
}

/** MARKETPLACE §2.4 "Created": only while the delivery is still unassigned. */
async function openJob(
  tx: Tx,
  graph: LockedGraph,
  deliveryId: string,
  targetPickupAt: number | null,
  updatedBy: string,
): Promise<void> {
  const row = graph.deliveries.get(deliveryId);
  if (!row) return;
  const before = toDelivery(row);
  const now = tx.now;
  let next: Delivery;
  if (before.status === 'unassigned') {
    const opensAt = offerOpensAt(targetPickupAt ?? now, now);
    next = await saveDelivery(tx, {
      ...before,
      offerOpensAt: opensAt,
      offerStatus: opensAt <= now ? 'open' : 'scheduled',
      updatedBy,
    });
    refreshDelivery(graph, next);
    await stageJobOffer(tx, next, { opensAt });
  } else if (before.offerStatus === 'held') {
    // Dispatch assigned a driver while the store had not accepted yet: the driver keeps the job.
    next = await saveDelivery(tx, {
      ...before,
      offerStatus: 'claimed',
      offerOpensAt: before.offerOpensAt ?? now,
      updatedBy,
    });
    refreshDelivery(graph, next);
  } else {
    return;
  }
  await applyDeliveryEffects(tx, graph, before, next);
}
