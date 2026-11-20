/**
 * Staff wording for the marketplace fields of a delivery (MARKETPLACE §1.3, §2.3, §2.4): kind, job
 * offer status, vehicle class and pickup phase. Domain rules stay in @instasupply/shared; this file only
 * names things for the ops screens.
 */
import {
  CITIES,
  VEHICLE_CLASSES,
  type CityId,
  type Delivery,
  type StatusTone,
  type VehicleClass,
} from '@instasupply/shared';

export const KIND_LABEL: Record<Delivery['kind'], string> = {
  marketplace: 'Store order',
  manual: 'Manual',
};

type OfferStatus = NonNullable<Delivery['offerStatus']>;

export const OFFER_STATUS_META: Record<OfferStatus, { label: string; tone: StatusTone; hint: string }> = {
  held: { label: 'Held', tone: 'neutral', hint: 'Waiting for the store to accept the order.' },
  scheduled: { label: 'Scheduled', tone: 'info', hint: 'On the job board 12 hours before pickup.' },
  open: { label: 'On the board', tone: 'warning', hint: 'Open to drivers; nobody has claimed it yet.' },
  claimed: { label: 'Claimed', tone: 'success', hint: 'A driver has the job.' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', hint: 'Cancelled before collection.' },
};

export function vehicleClassLabel(vehicleClass: VehicleClass | null | undefined): string {
  return vehicleClass ? (VEHICLE_CLASSES[vehicleClass]?.label ?? vehicleClass) : '—';
}

export function cityName(cityId: CityId | null | undefined): string {
  return cityId ? (CITIES[cityId]?.name ?? cityId) : '—';
}

/** True while the load is still at the store (the pickup leg is open). */
export function awaitingPickup(delivery: Pick<Delivery, 'pickup'>): boolean {
  return !!delivery.pickup && delivery.pickup.collectedAt == null;
}

/** Where a driver goes next for this delivery: the store while the load is not collected, else the site. */
export function nextStopOf(delivery: Pick<Delivery, 'pickup' | 'location'>) {
  return delivery.pickup && delivery.pickup.collectedAt == null
    ? delivery.pickup.location
    : delivery.location;
}
