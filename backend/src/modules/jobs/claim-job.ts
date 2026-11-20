/**
 * `claimJob` (MARKETPLACE §5.5.3; docs/PLATFORM.md §9.2.5). Locks users(driver, customer) → orders → store
 * orders → deliveries → job_offers, so two drivers claiming the same offer queue on the same rows: the
 * second finds no offer and a delivery that is not `unassigned` and gets `OFFER_TAKEN`. The driver row lock
 * makes the 4-job limit race-free (§3.6 rule 2).
 */
import {
  ACTIVE_STATUSES,
  MAX_ACTIVE_JOBS_PER_DRIVER,
  canCarry,
  capacityClassFor,
  type ClaimJobRequest,
  type ClaimJobResponse,
  type Delivery,
  type DriverVehicle,
  type JobOffer,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { audienceKey } from '../../platform/auth/policies';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failCode, notFound, permissionDenied } from '../../platform/http/errors';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { eventActorOf } from '../deliveries/delivery-writer';
import { DRIVER_FLOW_RESET, storeOrderOf } from '../deliveries/release';
import {
  countActiveDeliveries,
  deliveryOf,
  findDeliveryKeys,
  insertEvent,
  saveDelivery,
} from '../deliveries/repository';
import { stagePickupCode } from '../store-orders';
import { deleteJobOffer } from './offers';

const MINUTE = 60_000;
export const RELEASE_COOLDOWN_MS = 60 * MINUTE;
export const NEAR_PICKUP_MS = 120 * MINUTE;
export const LOCATION_FRESH_MS = 10 * MINUTE;

const TAKEN = 'Someone else just took this job.';

export async function claimJob(
  ctx: RequestContext,
  actor: Actor,
  req: ClaimJobRequest,
): Promise<ClaimJobResponse> {
  const answer: ClaimJobResponse = { deliveryId: req.deliveryId, status: 'accepted' };
  const keys = await findDeliveryKeys(ctx.deps.pool, req.deliveryId);
  if (!keys || keys.kind !== 'marketplace') notFound('This job is no longer available.');
  if (keys.driver_id === actor.uid && keys.status === 'accepted') return answer;
  await ctx.deps.hooks.at('claimJob:beforeTransaction');

  await withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, {
      deliveryIds: [req.deliveryId],
      userIds: [actor.uid],
      withOffers: true,
    });
    await ctx.deps.hooks.at('claimJob:locked');
    const delivery = deliveryOf(graph, req.deliveryId);
    if (!delivery) notFound('This job is no longer available.');
    if (delivery.driverId === actor.uid && delivery.status === 'accepted') return;
    const offerRow = graph.offers.get(req.deliveryId);
    const offer = offerRow ? (offerRow.doc as unknown as Omit<JobOffer, 'deliveryId'>) : null;
    if (!offer || offer.status !== 'open' || delivery.status !== 'unassigned' || !delivery.pickup) {
      failCode('OFFER_TAKEN', TAKEN);
    }

    // The audience rule of §7.4, from the locked row (never from the request).
    const driver = graph.users.get(actor.uid);
    if (!driver || driver.role !== 'driver' || driver.status !== 'active') permissionDenied();
    const key = audienceKey({
      cityId: driver.city_id as Actor['cityId'],
      capacityClass: driver.capacity_class as Actor['capacityClass'],
    });
    if (!offer.audience.includes(key)) {
      if (!offer.cityIds.includes(driver.city_id as JobOffer['cityIds'][number])) permissionDenied();
      failCode('VEHICLE_TOO_SMALL', 'Your vehicle is not the right size for this job.');
    }
    const profile = driver.doc as { vehicleReviewRequired?: boolean; vehicleDraft?: DriverVehicle | null };
    if (profile.vehicleReviewRequired && profile.vehicleDraft) {
      const draftClass = profile.vehicleDraft.capacityClass ?? capacityClassFor(profile.vehicleDraft);
      if (!canCarry(draftClass, offer.vehicleClass)) {
        failCode(
          'VEHICLE_TOO_SMALL',
          'Your new vehicle is waiting for review and is too small for this job.',
        );
      }
    }
    const active = await countActiveDeliveries(tx, actor.uid, ACTIVE_STATUSES);
    if (active >= MAX_ACTIVE_JOBS_PER_DRIVER) {
      failCode(
        'TOO_MANY_JOBS',
        `You already have ${MAX_ACTIVE_JOBS_PER_DRIVER} active jobs. Finish one first.`,
      );
    }
    const releasedAt = delivery.releasedBy?.[actor.uid];
    if (typeof releasedAt === 'number' && tx.now - releasedAt < RELEASE_COOLDOWN_MS) {
      failCode('RELEASED_RECENTLY', 'You released this job less than an hour ago.');
    }
    const so = storeOrderOf(graph, delivery.storeOrderId);
    const targetPickupAt = so?.timing.targetPickupAt ?? delivery.pickup.readyBy;
    if (targetPickupAt - tx.now <= NEAR_PICKUP_MS) {
      const { rows } = await tx.query<{ online: boolean; updated_at: number }>(
        'SELECT online, updated_at FROM driver_locations WHERE driver_id = $1',
        [actor.uid],
      );
      const location = rows[0];
      if (!location || !location.online || location.updated_at < tx.now - LOCATION_FRESH_MS) {
        failCode('DRIVER_OFFLINE', 'Go online with your location on to take a job that is due soon.');
      }
    }

    const pin = await stagePickupCode(tx, delivery.storeOrderId!, actor.uid);
    const next: Delivery = {
      ...delivery,
      ...DRIVER_FLOW_RESET,
      driverId: actor.uid,
      driverName: driver.display_name,
      status: 'accepted',
      assignedAt: tx.now,
      acceptedAt: tx.now,
      offerStatus: 'claimed',
      pickup: { ...delivery.pickup, pickupCode: pin, arrivedAt: null },
      updatedBy: actor.uid,
    };
    const saved = await saveDelivery(tx, graph, next);
    const who = eventActorOf(actor);
    await insertEvent(tx, saved, who, {
      type: 'assigned',
      status: 'assigned',
      fromStatus: 'unassigned',
      message: 'Claimed from the job board',
    });
    await insertEvent(tx, saved, who, {
      type: 'status',
      status: 'accepted',
      fromStatus: 'unassigned',
      message: 'Driver accepted the delivery',
    });
    await deleteJobOffer(tx, delivery.id);
    await applyDeliveryEffects(tx, graph, delivery, saved);
  });
  return answer;
}
