/**
 * The declarative map props of docs/CLIENTS.md §7.2, shared in shape with the two Expo apps so a
 * screen describes what to draw, not how. The console renders them with react-leaflet directly
 * (no DOM component), see `AppMap.tsx`.
 */
import type { LatLng } from '@instasupply/shared';

export type MapTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger';

export interface MapMarker {
  id: string;
  position: LatLng;
  /** store: storefront glyph. site: house glyph. driver: initials with heading arrow. stop: numbered pin. pin: the draggable pin. */
  kind: 'store' | 'site' | 'driver' | 'stop' | 'pin';
  /** At most 3 characters (stop number); for a driver the name whose initials are drawn. */
  label?: string;
  /** Tooltip; also the marker's accessible name. */
  title?: string;
  tone?: MapTone;
  heading?: number | null;
  highlighted?: boolean;
  /** Driver whose last fix is old: drawn grey, without the pulse. */
  stale?: boolean;
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
  padding?: number;
  maxZoom?: number;
}

/** A pin the user places. Controlled: the parent holds `position` and updates it in `onPick`. */
export interface MapPick {
  position: LatLng | null;
  draggable?: boolean;
  tapToPlace?: boolean;
}

export const TONE_HEX: Record<MapTone, string> = {
  brand: '#4f46e5',
  neutral: '#475569',
  success: '#059669',
  warning: '#d97706',
  danger: '#e11d48',
};

/** A fit key that changes only when a point moves by about 10 m (4 decimals). */
export function fitKeyFor(points: readonly (LatLng | null | undefined)[]): string {
  return points.map((point) => (point ? `${point.lat.toFixed(4)},${point.lng.toFixed(4)}` : '-')).join('|');
}
