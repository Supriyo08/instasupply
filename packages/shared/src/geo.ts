import type { LatLng } from './types';

const EARTH_RADIUS_M = 6_371_000;

/** Typical ratio between road distance and straight-line distance in cities. */
export const ROAD_DISTANCE_FACTOR = 1.35;

/**
 * Average driving speed for estimates when the vehicle is not known: the GTA figure (§12.1). Where the
 * vehicle class is known, promises, route plans and tracking use that class's own `speedKmh` (§3.3).
 */
export const DEFAULT_CITY_SPEED_KMH = 36;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function isValidLatLng(point: unknown): point is LatLng {
  if (!point || typeof point !== 'object') return false;
  const { lat, lng } = point as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  // Squares are plain multiplications: every engine multiplies alike, while `**` goes through each
  // platform's own `pow`. Delivery fees are charged on this distance (`roadTenths`).
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * (sinLng * sinLng);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north (0–360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Estimated road distance for a straight-line distance. */
export function estimateRoadMeters(straightLineMeters: number): number {
  return straightLineMeters * ROAD_DISTANCE_FACTOR;
}

/**
 * A point with latitude and longitude rounded to 6 decimals (about 11 cm). Pins are compared at this
 * precision so that the same jobsite gives the same distance, and so the same fee, on every device
 * (§3.1 rule 5).
 */
export function r6(point: LatLng): LatLng {
  return { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 };
}

/**
 * Road distance between two points in whole tenths of a kilometre, rounded up (§3.1 rule 5). Delivery
 * fees, driver pay and drive times are all computed from this integer, never from a float distance;
 * `roadKm` is `roadTenths / 10`.
 *
 * The small epsilon keeps a distance that lands exactly on a tenth from tipping into the next one
 * because of float noise, so Hermes and V8 charge the same fee.
 */
export function roadTenths(a: LatLng, b: LatLng): number {
  if (!isValidLatLng(a) || !isValidLatLng(b)) {
    throw new RangeError('roadTenths: both points need a valid latitude and longitude');
  }
  const tenths = Math.ceil((haversineMeters(r6(a), r6(b)) * ROAD_DISTANCE_FACTOR) / 100 - 1e-6);
  // Two identical points would give -0, which `Object.is` and test assertions tell apart from 0.
  return Math.max(0, tenths);
}

/** Estimated driving time in seconds for a road distance. */
export function estimateDriveSeconds(roadMeters: number, speedKmh = DEFAULT_CITY_SPEED_KMH): number {
  const metersPerSecond = (speedKmh * 1000) / 3600;
  return roadMeters / metersPerSecond;
}

/** Linear interpolation between two points (fine for the short hops used in animation). */
export function interpolateLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return { lat: a.lat + (b.lat - a.lat) * clamped, lng: a.lng + (b.lng - a.lng) * clamped };
}

/** Point reached after moving `meters` from `a` towards `b` (clamped at `b`). */
export function moveTowards(a: LatLng, b: LatLng, meters: number): LatLng {
  const total = haversineMeters(a, b);
  if (total === 0 || meters >= total) return { ...b };
  return interpolateLatLng(a, b, meters / total);
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  return { south, west, north, east };
}

export function centerOf(points: readonly LatLng[]): LatLng | null {
  const bounds = boundsOf(points);
  if (!bounds) return null;
  return { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
}

/** Total length of a polyline in metres. */
export function pathLengthMeters(path: readonly LatLng[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += haversineMeters(path[index - 1]!, path[index]!);
  }
  return total;
}
