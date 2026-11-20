/**
 * `checkInAtStore` (MARKETPLACE §5.4, §2.3; docs/PLATFORM.md §9.2.6): the assigned driver is at the store's
 * counter. `pickup.arrivedAt` is set once (a repeat answers as if it had just happened), an event is written
 * and the store is told to ask for the driver's PIN. The projection shows the phase `at_store`.
 */
import { firstName, type CheckInAtStoreRequest, type OkResponse } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failedPrecondition, notFound, permissionDenied } from '../../platform/http/errors';
import { notifyStoreMembers } from '../notifications';
import { applyDeliveryEffects } from './delivery-effects';
import { eventActorOf } from './delivery-writer';
import { deliveryOf, findDeliveryKeys, insertEvent, saveDelivery } from './repository';

export async function checkInAtStore(
  ctx: RequestContext,
  actor: Actor,
  req: CheckInAtStoreRequest,
): Promise<OkResponse> {
  const keys = await findDeliveryKeys(ctx.deps.pool, req.deliveryId);
  if (!keys) notFound('This delivery no longer exists.');
  if (keys.driver_id !== actor.uid) permissionDenied('This delivery is not assigned to you.');

  await withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, {
      deliveryIds: [req.deliveryId],
      userIds: [actor.uid],
      withOffers: true,
    });
    const delivery = deliveryOf(graph, req.deliveryId);
    if (!delivery) notFound('This delivery no longer exists.');
    if (delivery.driverId !== actor.uid) permissionDenied('This delivery is not assigned to you.');
    const pickup = delivery.pickup;
    if (!pickup) failedPrecondition('This delivery has no store pickup.');
    if (pickup.arrivedAt !== null) return;
    if (delivery.status !== 'accepted' || pickup.collectedAt !== null) {
      failedPrecondition('You can check in at the store only for an accepted job that is not collected yet.');
    }
    const saved = await saveDelivery(tx, graph, {
      ...delivery,
      pickup: { ...pickup, arrivedAt: tx.now },
      updatedBy: actor.uid,
    });
    await insertEvent(tx, saved, eventActorOf(actor), {
      type: 'note',
      message: `Checked in at ${pickup.storeName}`,
      location: req.location ?? null,
    });
    if (delivery.storeOrderId) {
      const name = firstName(delivery.driverName) || 'The driver';
      await notifyStoreMembers(tx, pickup.storeId, {
        type: 'store_order_update',
        title: `${name} is at the counter`,
        body: `${name} is at the counter for ${delivery.orderId} — ask for the pickup PIN.`,
        data: { storeOrderId: delivery.storeOrderId },
        key: `so-checkin-${delivery.id}-${actor.uid}`,
      });
    }
    await applyDeliveryEffects(tx, graph, delivery, saved);
  });
  return { ok: true };
}
