import type { LatLng } from '@instasupply/shared';
import type { StyleProp, ViewStyle } from 'react-native';

/** Props shared by the native (react-native-maps) and web (Leaflet) tracking maps. */
export interface TrackingMapProps {
  /** The delivery address. */
  destination: LatLng;
  /** Live driver position; `heading` is degrees clockwise from north when the device reports it. */
  driver: { location: LatLng; heading: number | null } | null;
  /** Give the map a height (it fills its container). */
  style?: StyleProp<ViewStyle>;
  /** Spoken summary: the map is a picture for screen readers. */
  accessibilityLabel: string;
}

/** Changes only when a point moves ~10 m or more, so GPS jitter doesn't keep re-fitting the camera. */
export function fitKeyFor(points: readonly LatLng[]): string {
  return points.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|');
}

/** Heading rounded to 5° (null when unknown) so tiny compass changes don't redraw the marker. */
export function roundedHeading(heading: number | null | undefined): number | null {
  if (heading == null || !Number.isFinite(heading)) return null;
  return (Math.round(heading / 5) * 5) % 360;
}

/**
 * Google Maps link for when the map itself can't be drawn: the driver's route to the address, or
 * just the address while there is no driver position. Opens the Maps app, or the browser without it.
 */
export function mapsUrlFor(destination: LatLng, driver: LatLng | null): string {
  const point = (location: LatLng) => encodeURIComponent(`${location.lat},${location.lng}`);
  return driver
    ? `https://www.google.com/maps/dir/?api=1&origin=${point(driver)}&destination=${point(destination)}&travelmode=driving`
    : `https://www.google.com/maps/search/?api=1&query=${point(destination)}`;
}
