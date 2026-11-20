import { formatClockET, formatDistance, type PublicTracking } from '@instasupply/shared';

/**
 * What the driver is doing, in the customer's words (MARKETPLACE §7.3 track row): "Heading to Kestrel
 * Lumber Yard" → "Loaded at the store" → "On the way to your site".
 */
export function trackingPhaseText(tracking: PublicTracking): string {
  const driver = tracking.driver?.firstName ?? 'Your driver';
  const store = tracking.pickup?.storeName ?? 'the store';
  switch (tracking.phase) {
    case 'finding_driver':
      return 'Finding a driver';
    case 'driver_assigned':
      return `${driver} is assigned to your delivery`;
    case 'to_store':
      return `Heading to ${store}`;
    case 'at_store':
      return `At ${store}, loading up`;
    case 'loaded':
      return 'Loaded at the store';
    case 'to_site':
      return 'On the way to your site';
    case 'at_site':
      return `${driver} is at your site`;
    case 'delivered':
      return 'Delivered';
    case 'problem':
      return "Delivery issue — we're on it";
    case 'cancelled':
      return 'Delivery cancelled';
    default:
      return 'On the way';
  }
}

/** True while the truck is moving towards the site: the live ETA is worth showing then. */
export function isInTransit(tracking: PublicTracking): boolean {
  return tracking.phase === 'to_site' || tracking.phase === 'loaded';
}

/** "Arriving in 25 min · 8.4 km away", or the deliver-by promise when there is no live ETA. */
export function etaText(tracking: PublicTracking, now: number): string | null {
  if (isInTransit(tracking) && tracking.etaSeconds != null) {
    const minutes = Math.max(1, Math.round(tracking.etaSeconds / 60));
    const arrival = formatClockET(now + tracking.etaSeconds * 1000);
    const distance =
      tracking.distanceMeters != null ? ` · ${formatDistance(tracking.distanceMeters)} away` : '';
    return `Arriving in ${minutes} min (about ${arrival})${distance}`;
  }
  if (tracking.deliverBy != null) return `Delivery by ${formatClockET(tracking.deliverBy)}`;
  return tracking.windowLabel;
}
