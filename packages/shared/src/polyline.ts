import type { LatLng } from './types';

/** Decode a Google / OSRM encoded polyline (precision 5 by default). */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readValue = () => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('Malformed polyline.');
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

/** Encode points as a polyline string (precision 5 by default). */
export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLng = 0;
  let output = '';

  const writeValue = (value: number) => {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    while (shifted >= 0x20) {
      output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
      shifted >>= 5;
    }
    output += String.fromCharCode(shifted + 63);
  };

  for (const point of points) {
    const lat = Math.round(point.lat * factor);
    const lng = Math.round(point.lng * factor);
    writeValue(lat - previousLat);
    writeValue(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
  }
  return output;
}

/**
 * Reduce a polyline to at most `maxPoints` points by uniform sampling, always keeping both ends.
 * Keeps route documents small enough for Firestore and fast to draw.
 */
export function simplifyPath(points: readonly LatLng[], maxPoints = 500): LatLng[] {
  const limit = Math.floor(maxPoints);
  if (points.length <= limit) return points.slice();
  // Both ends fit only when there is room for two points; with less, keep what fits from the start.
  if (limit < 2) return points.slice(0, Math.max(0, limit));
  const step = (points.length - 1) / (limit - 1);
  const result: LatLng[] = [];
  for (let index = 0; index < limit; index += 1) {
    // `index * step` runs from 0 to the last index, so the point exists; the check is for the compiler.
    const point = points[Math.round(index * step)];
    if (point) result.push(point);
  }
  return result;
}
