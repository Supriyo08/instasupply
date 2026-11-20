/**
 * `updateStoreOrderStatus` (MARKETPLACE §2.1, §5.4 → docs/PLATFORM.md §9.2.2):
 * - `accepted → preparing`;
 * - `accepted | preparing → ready` (optional shortages): `pickup.readyAt`; delivery `pickup.ready`, `readyAt`, the
 *   offer's `pickup.ready`, the driver told; pickup: `holdUntil` (MARKETPLACE §4.5) and the customer gets the PIN;
 * - `ready → preparing` ("not ready after all"): `pickup.ready = false` on the delivery and the offer.
 * Shorting every line to 0 when marking ready is a store cancel with reason `out_of_stock`.
 */
import {
  canStoreOrderTransition,
  pickupHoldUntil,
  type StoreOrder,
  type StoreOrderActionResponse,
  type UpdateStoreOrderStatusRequest,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import type { LockedGraph } from '../../platform/db/locks';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failedPrecondition, invalidArgument } from '../../platform/http/errors';
import { projectOrderAggregate } from '../commerce/order-aggregate';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { notifyDrivers } from '../notifications/notify';
import { orderActorFrom } from './access';
import { checkVersion, keysForAction, lockStoreOrder, refreshDelivery } from './command-support';
import { applyStoreOrderEffects } from './store-order-effects';
import { stageStoreOrderVoid } from './store-order-void';
import { readStoreInfo, saveDelivery, setOfferPickupReady, toDelivery } from './store-orders.repository';
import {
  adjustmentsEmptyOrder,
  resolveActor,
  stageStoreOrderTransition,
  validateAdjustments,
} from './transitions';

export async function updateStoreOrderStatus(
  deps: Deps,
  actor: Actor,
  req: UpdateStoreOrderStatusRequest,
): Promise<StoreOrderActionResponse> {
  if (req.status === 'preparing' && req.adjustments && req.adjustments.length > 0) {
    invalidArgument('Shortages are recorded when you accept or mark the order ready.', {
      fields: { adjustments: 'only with ready' },
    });
  }
  const keys = await keysForAction(deps, actor, req.storeOrderId);
  const who = orderActorFrom(actor);
  return withTransaction(deps, async (tx) => {
    const { graph, so } = await lockStoreOrder(tx, keys);
    checkVersion(so, req.expectedVersion);
    validateAdjustments(so, req.adjustments);
    const kind = resolveActor(who).kind;
    if (!canStoreOrderTransition(so.status, req.status, kind, { fulfilment: so.fulfilment })) {
      failedPrecondition(`${so.number} is ${so.status} and can't be marked ${req.status}.`, {
        status: so.status,
      });
    }
    if (req.status === 'ready' && adjustmentsEmptyOrder(so, req.adjustments)) {
      const voided = await stageStoreOrderVoid(tx, graph, so, who, {
        to: 'cancelled',
        reason: 'out_of_stock',
        note: req.note ?? null,
        adjustments: req.adjustments,
      });
      return { status: voided.status, version: voided.version };
    }

    const now = tx.now;
    let after: StoreOrder;
    if (req.status === 'ready') {
      const holdUntil =
        so.fulfilment === 'pickup'
          ? pickupHoldUntil((await readStoreInfo(tx, so.storeId)).schedule, now)
          : null;
      after = await stageStoreOrderTransition(tx, graph, so, 'ready', who, {
        adjustments: req.adjustments,
        note: req.note ?? undefined,
        extra: { pickup: { ...so.pickup, readyAt: now, holdUntil } },
      });
    } else {
      after = await stageStoreOrderTransition(tx, graph, so, 'preparing', who, {
        note: req.note ?? undefined,
        // Back from ready: nothing is held at the counter any more.
        extra: so.status === 'ready' ? { pickup: { ...so.pickup, holdUntil: null } } : {},
      });
    }
    await applyStoreOrderEffects(tx, graph, so, after);
    if (so.deliveryId && (req.status === 'ready' || so.status === 'ready')) {
      await setPickupReady(tx, graph, after, req.status === 'ready', actor.uid);
    }
    await projectOrderAggregate(tx, graph, so.orderId);
    return { status: after.status, version: after.version };
  });
}

/** The delivery's and the offer's `pickup.ready`; the assigned driver hears that the load is ready. */
async function setPickupReady(
  tx: Tx,
  graph: LockedGraph,
  so: StoreOrder,
  ready: boolean,
  updatedBy: string,
): Promise<void> {
  const row = so.deliveryId ? graph.deliveries.get(so.deliveryId) : undefined;
  if (!row) return;
  const before = toDelivery(row);
  if (!before.pickup) return;
  const now = tx.now;
  const after = await saveDelivery(tx, {
    ...before,
    pickup: { ...before.pickup, ready, readyAt: ready ? now : before.pickup.readyAt },
    updatedBy,
  });
  refreshDelivery(graph, after);
  await setOfferPickupReady(tx, before.id, ready);
  if (ready && after.driverId) {
    await notifyDrivers(tx, [after.driverId], {
      type: 'job_update',
      title: `${so.number} is ready`,
      body: `${so.number} is ready at ${so.storeName}.`,
      data: { deliveryId: after.id },
      key: `job-ready-${after.id}-v${so.version}`,
    });
  }
  await applyDeliveryEffects(tx, graph, before, after);
}
