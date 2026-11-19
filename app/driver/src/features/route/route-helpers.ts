import type { LatLng, RoutePlan } from '@instasupply/shared';

import type { PlannedStop } from '@/features/deliveries/hooks';

import type { MapStop } from './map-types';

/** The stop the driver should work on next: anything already started, else the first in order. */
export function nextStopOf(stops: PlannedStop[]): PlannedStop | null {
  return (
    stops.find((stop) => stop.delivery.status === 'arrived' || stop.delivery.status === 'in_transit') ??
    stops.find((stop) => stop.delivery.status !== 'assigned') ??
    null
  );
}

export function toMapStops(stops: PlannedStop[], nextId: string | null): MapStop[] {
  return stops.map((stop) => ({
    id: stop.delivery.id,
    location: stop.delivery.location,
    label: String(stop.sequence),
    title: `${stop.sequence}. ${stop.delivery.customer.name}`,
    subtitle: stop.delivery.address,
    status: stop.delivery.status,
    highlighted: stop.delivery.id === nextId,
  }));
}

/** Planned road geometry when we have it, otherwise a straight line through the stops. */
export function routePath(route: RoutePlan | null, driver: LatLng | null, stops: PlannedStop[]): LatLng[] {
  if (route?.polyline && route.polyline.length > 1) return route.polyline;
  return [...(driver ? [driver] : []), ...stops.map((stop) => stop.delivery.location)];
}
