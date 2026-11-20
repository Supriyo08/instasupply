/**
 * `assignDelivery` (MARKETPLACE §5.4; docs/PLATFORM.md §9.2.7), port of legacy/…/assign-delivery.ts. Locks
 * the new driver, the previous one and the customer, then the order chain, the delivery and its offer.
 * Marketplace jobs are (re)assigned only before collection and only to a vehicle that can carry them
 * (unless `force`); the new driver gets a fresh PIN and the offer is deleted. Unassigning re-creates it.
 */
import {
  canCarry,
  requiresPickup,
  statusLabel,
  type AssignDeliveryRequest,
  type Delivery,
  type OkResponse,
  type VehicleClass,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failCode, failedPrecondition, notFound } from '../../platform/http/errors';
import { deleteJobOffer } from '../jobs/offers';
import { stagePickupCode } from '../store-orders';
import { applyDeliveryEffects } from './delivery-effects';
import { eventActorOf } from './delivery-writer';
import { DRIVER_FLOW_RESET, stageRelease } from './release';
import { deliveryOf, findDeliveryKeys, insertEvent, saveDelivery } from './repository';

const MANUAL_REASSIGNABLE = new Set([
  'unassigned',
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'arrived',
  'failed',
]);
const MARKETPLACE_ASSIGNABLE = new Set(['unassigned', 'assigned', 'accepted']);

export async function assignDelivery(
  ctx: RequestContext,
  actor: Actor,
  req: AssignDeliveryRequest,
): Promise<OkResponse> {
  const keys = await findDeliveryKeys(ctx.deps.pool, req.deliveryId);
  if (!keys) notFound('This delivery no longer exists.');
  const driverId = req.driverId;
  const note = req.note ? ` — ${req.note}` : '';

  await withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, {
      deliveryIds: [req.deliveryId],
      userIds: driverId ? [driverId] : [],
      withOffers: true,
    });
    const delivery = deliveryOf(graph, req.deliveryId);
    if (!delivery) notFound('This delivery no longer exists.');
    const marketplace = delivery.kind === 'marketplace';
    if (marketplace) {
      if (!MARKETPLACE_ASSIGNABLE.has(delivery.status) || !requiresPickup(delivery)) {
        failedPrecondition('A job can only be reassigned before the driver collects it at the store.');
      }
    } else if (!MANUAL_REASSIGNABLE.has(delivery.status)) {
      failedPrecondition(`A ${statusLabel(delivery.status).toLowerCase()} delivery can't be reassigned.`);
    }

    const driver = driverId ? graph.users.get(driverId) : undefined;
    if (driverId && (!driver || driver.role !== 'driver' || driver.status !== 'active')) {
      failedPrecondition('That driver is not approved or has been suspended.');
    }
    if (driverId === delivery.driverId && delivery.status !== 'failed') return; // nothing to do
    if (driverId === null && delivery.driverId === null) return;

    const who = eventActorOf(actor);
    const previous = delivery.driverName ? ` (was ${delivery.driverName})` : '';
    let saved: Delivery;
    if (driverId === null) {
      saved = await stageRelease(tx, graph, delivery, who, {
        byDriverId: null,
        eventType: 'unassigned',
        message: `Unassigned${previous}${note}`,
      });
    } else {
      const capacity = driver!.capacity_class as VehicleClass | null;
      if (marketplace && delivery.vehicleClass && !req.force) {
        if (!capacity || !canCarry(capacity, delivery.vehicleClass)) {
          failCode('VEHICLE_TOO_SMALL', `${driver!.display_name}'s vehicle is too small for this job.`);
        }
      }
      const isRetry = delivery.status === 'failed';
      const pin =
        marketplace && delivery.storeOrderId
          ? await stagePickupCode(tx, delivery.storeOrderId, driverId)
          : null;
      const next: Delivery = {
        ...delivery,
        ...DRIVER_FLOW_RESET,
        driverId,
        driverName: driver!.display_name,
        status: 'assigned',
        assignedAt: tx.now,
        failure: isRetry ? null : delivery.failure,
        failedAt: isRetry ? null : (delivery.failedAt ?? null),
        attempts: isRetry ? delivery.attempts + 1 : delivery.attempts,
        offerStatus: marketplace ? 'claimed' : delivery.offerStatus,
        pickup: delivery.pickup ? { ...delivery.pickup, pickupCode: pin, arrivedAt: null } : null,
        updatedBy: actor.uid,
      };
      saved = await saveDelivery(tx, graph, next);
      await insertEvent(tx, saved, who, {
        type: 'assigned',
        status: 'assigned',
        fromStatus: delivery.status,
        message: `${isRetry ? 'Retry assigned' : 'Assigned'} to ${driver!.display_name}${previous}${note}`,
      });
      await deleteJobOffer(tx, delivery.id);
    }
    await applyDeliveryEffects(tx, graph, delivery, saved);
  });
  return { ok: true };
}
