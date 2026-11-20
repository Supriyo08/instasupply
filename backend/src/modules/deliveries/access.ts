/**
 * The object checks of docs/PLATFORM.md §7.3 that the deliveries, jobs and drivers modules apply. Routes
 * and commands never inline them.
 */
import type { Delivery, JobOffer } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { audienceKey } from '../../platform/auth/policies';

/** Staff, or the driver the delivery is assigned to. */
export function canReadDelivery(actor: Actor, delivery: Pick<Delivery, 'driverId'>): boolean {
  if (actor.isStaff) return true;
  return actor.role === 'driver' && delivery.driverId !== null && delivery.driverId === actor.uid;
}

/** `canReadDelivery`, or the customer of the delivery. */
export function canReadProof(actor: Actor, delivery: Pick<Delivery, 'driverId' | 'customerId'>): boolean {
  return (
    canReadDelivery(actor, delivery) || (delivery.customerId != null && delivery.customerId === actor.uid)
  );
}

/** Staff, or an active driver whose `{cityId}:{capacityClass}` is in the audience of an open offer (§7.4). */
export function canSeeOffer(actor: Actor, offer: Pick<JobOffer, 'status' | 'audience'>): boolean {
  if (actor.isStaff) return true;
  if (actor.role !== 'driver' || !actor.isActive || !actor.cityId || !actor.capacityClass) return false;
  return offer.status === 'open' && offer.audience.includes(audienceKey(actor));
}
