/**
 * Was onJobOfferWritten (docs/PLATFORM.md §9.4): when an offer becomes `open`, tell up to 20 active, online
 * drivers whose `{cityId}:{capacityClass}` is in its audience (statement (i)), once per opening.
 */
import { VEHICLE_CLASSES, formatMoney, type JobOffer } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { notifyDrivers } from '../notifications';
import { onlineDriversFor } from './repository';

const shortName = (name: string): string => name.split(' ')[0] ?? name;

/** "$47.75 · Kestrel, Etobicoke → Leslieville · Pickup truck · 182 kg" (MARKETPLACE §5.8). */
export function offerSummary(offer: JobOffer): string {
  const from = [shortName(offer.pickup.storeName), offer.pickup.areaLabel].filter(Boolean).join(', ');
  const to = offer.dropoff.areaLabel.split(' · ')[0] ?? offer.dropoff.areaLabel;
  return [
    formatMoney(offer.payoutCents),
    `${from} → ${to}`,
    VEHICLE_CLASSES[offer.vehicleClass].label,
    `${offer.load.weightKg} kg`,
  ].join(' · ');
}

export async function notifyOfferOpened(tx: Tx, offer: JobOffer): Promise<void> {
  if (offer.status !== 'open' || offer.openedAt === null) return;
  const drivers = await onlineDriversFor(tx, offer.audience);
  await notifyDrivers(tx, drivers, {
    type: 'job_offer',
    title: `New job · ${formatMoney(offer.payoutCents)}`,
    body: offerSummary(offer),
    data: { deliveryId: offer.deliveryId },
    key: `offer-${offer.deliveryId}-${offer.openedAt}`,
  });
}
