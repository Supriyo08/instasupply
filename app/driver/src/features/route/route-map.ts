/** Props for `AppMap` on the Route tab and the delivery preview (docs/CLIENTS.md §7.4). */
import type { LatLng, RoutePlan } from '@instasupply/shared';

import type { MapMarker, MapPolyline } from '@/components/map';
import type { PlannedStop } from '@/features/deliveries/hooks';
import type { Fix } from '@/features/location/publisher';

/** The driver's own marker from the last accepted fix. */
export function driverMarker(fix: Fix | null): MapMarker | null {
  if (!fix) return null;
  return {
    id: 'driver',
    kind: 'driver',
    position: { lat: fix.lat, lng: fix.lng },
    heading: fix.heading,
    tone: 'brand',
    glide: true,
    title: 'You',
  };
}

/** One `stop` marker per route stop, numbered; pickups warning, drop-offs brand, the next stop highlighted. */
export function stopMarkers(stops: readonly PlannedStop[], nextKey: string | null): MapMarker[] {
  return stops.map((stop) => ({
    id: stop.key,
    kind: 'stop',
    position: stop.location,
    label: String(stop.sequence),
    title: `${stop.sequence}. ${stop.kind === 'pickup' ? 'Pick up at' : 'Drop off at'} ${stop.title}`,
    tone: stop.kind === 'pickup' ? 'warning' : 'brand',
    highlighted: stop.key === nextKey,
  }));
}

/** The planned road geometry, else a straight line from the driver through the stops. */
export function routeLine(
  route: RoutePlan | null,
  driver: LatLng | null,
  stops: readonly PlannedStop[],
): MapPolyline {
  const points =
    route && route.polyline.length > 1
      ? route.polyline
      : [...(driver ? [driver] : []), ...stops.map((stop) => stop.location)];
  return { id: 'route', points, tone: 'brand', dashed: !(route && route.polyline.length > 1) };
}

/** `onMarkerPress` id → the delivery to open. */
export function deliveryIdOfStopKey(key: string): string {
  const separator = key.lastIndexOf(':');
  return separator > 0 ? key.slice(0, separator) : key;
}
