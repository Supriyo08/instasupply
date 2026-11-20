import type { LatLng } from '@instasupply/shared';
import type { StyleProp, ViewStyle } from 'react-native';

/** The `AppMap` contract (docs/CLIENTS.md §7.2), identical in the customer and driver apps. */
export type MapTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger';

export interface MapMarker {
  id: string;
  position: LatLng;
  /** store: storefront glyph. site: house glyph. driver: arrow rotated by `heading`, pulsing. stop: numbered circle. pin: the draggable teardrop. */
  kind: 'store' | 'site' | 'driver' | 'stop' | 'pin';
  /** At most 3 characters inside the marker (stop number, initials). */
  label?: string;
  /** Tooltip on the web; spoken label. */
  title?: string;
  tone?: MapTone;
  /** Degrees clockwise from north; rounded to 5° before drawing. */
  heading?: number | null;
  highlighted?: boolean;
  /** Glide to a new position over 1.2 s instead of jumping (jumps anyway beyond 5 km). */
  glide?: boolean;
  zIndex?: number;
}

export interface MapPolyline {
  id: string;
  points: LatLng[];
  tone?: MapTone;
  dashed?: boolean;
  /** Pixels, default 4. */
  weight?: number;
}

export interface MapCircle {
  id: string;
  center: LatLng;
  radiusM: number;
  tone?: MapTone;
}

/** The camera fits these points when `key` changes, and only then, so live updates never fight the user's panning. */
export interface MapFit {
  key: string;
  points: LatLng[];
  /** Pixels, default 48. */
  padding?: number;
  /** Default 16. One point is shown at min(maxZoom, 15). */
  maxZoom?: number;
}

/** A pin the user places. Controlled: the parent holds `position` and updates it in `onPick`. */
export interface MapPick {
  position: LatLng | null;
  /** Default true: dragging the pin reports its new position. */
  draggable?: boolean;
  /** Default true: tapping the map moves the pin there. */
  tapToPlace?: boolean;
}

export interface AppMapProps {
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  circles?: MapCircle[];
  fit?: MapFit | null;
  /** Used until the first fit. Default: Toronto, 43.6532, -79.3832, zoom 11. */
  initialCenter?: LatLng;
  initialZoom?: number;
  /** False (default): no gestures, touches pass to the page so it keeps scrolling. True: pan, pinch and zoom buttons. */
  interactive?: boolean;
  pick?: MapPick;
  onPick?: (point: LatLng) => void;
  onMarkerPress?: (id: string) => void;
  /** Give the map a height or flex; it fills its frame. */
  style?: StyleProp<ViewStyle>;
  /** The map is a picture to a screen reader: say what it shows. */
  accessibilityLabel: string;
}

/** Hex colours by tone, plus surface and text, from the app's theme tokens. */
export type MapPalette = Record<MapTone, string> & { surface: string; text: string };

export const TORONTO: LatLng = { lat: 43.6532, lng: -79.3832 };

/** Changes only when a point moves about 10 m or more (4 decimals), so GPS jitter never refits the camera. */
export function fitKeyFor(points: readonly LatLng[]): string {
  return points.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|');
}

/** Heading rounded to 5° (null when unknown) so tiny compass changes don't redraw the marker. */
export function roundedHeading(heading: number | null | undefined): number | null {
  if (heading == null || !Number.isFinite(heading)) return null;
  return (((Math.round(heading / 5) * 5) % 360) + 360) % 360;
}

/**
 * A maps link for the fallback card: the route from `origin` to `destination`, or just the
 * destination. Opens the Maps app, or the browser without it.
 */
export function mapsUrlFor(destination: LatLng, origin: LatLng | null = null): string {
  const point = (location: LatLng) => encodeURIComponent(`${location.lat},${location.lng}`);
  return origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${point(origin)}&destination=${point(destination)}&travelmode=driving`
    : `https://www.google.com/maps/search/?api=1&query=${point(destination)}`;
}
