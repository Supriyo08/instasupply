/**
 * Travel-time providers. Google Routes (traffic-aware) is preferred when a key is configured;
 * OSRM is an opt-in free alternative; straight-line estimates always work as the fallback.
 */
import {
  buildEstimateMatrix,
  decodePolyline,
  fillMatrixGaps,
  type LatLng,
  type RouteProvider,
  type TravelMatrix,
} from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';

import { settings } from '../../config/runtime';

const GOOGLE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const REQUEST_TIMEOUT_MS = 8000;

/** Google limits: 100 matrix elements with TRAFFIC_AWARE_OPTIMAL, 625 with TRAFFIC_AWARE. */
const GOOGLE_OPTIMAL_MAX_ELEMENTS = 100;
const GOOGLE_MAX_ELEMENTS = 625;
const GOOGLE_MAX_INTERMEDIATES = 25;
const OSRM_MAX_POINTS = 100;

const toWaypoint = (point: LatLng) => ({
  location: { latLng: { latitude: point.lat, longitude: point.lng } },
});

const parseSeconds = (value: string | undefined): number =>
  value ? Number.parseFloat(value.replace('s', '')) : Number.NaN;

function useGoogle(): boolean {
  const mode = settings.routingProvider;
  return (mode === 'auto' || mode === 'google') && !!settings.googleMapsApiKey;
}

interface GoogleMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
}

async function googleMatrix(points: LatLng[]): Promise<TravelMatrix> {
  const elements = points.length * points.length;
  const response = await fetch(GOOGLE_MATRIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': settings.googleMapsApiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify({
      origins: points.map((point) => ({ waypoint: toWaypoint(point) })),
      destinations: points.map((point) => ({ waypoint: toWaypoint(point) })),
      travelMode: 'DRIVE',
      routingPreference: elements <= GOOGLE_OPTIMAL_MAX_ELEMENTS ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Routes matrix ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  // The REST endpoint streams a JSON array; some proxies deliver newline-delimited JSON instead.
  const text = await response.text();
  let rows: GoogleMatrixElement[];
  try {
    const parsed = JSON.parse(text) as GoogleMatrixElement[] | GoogleMatrixElement;
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rows = text
      .split('\n')
      .map((line) => line.trim().replace(/^[[,]|[\],]$/g, ''))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GoogleMatrixElement);
  }

  const size = points.length;
  const seconds = Array.from({ length: size }, () => Array<number>(size).fill(Number.NaN));
  const meters = Array.from({ length: size }, () => Array<number>(size).fill(Number.NaN));
  for (const row of rows) {
    // Proto3 JSON omits zero values, so a missing index means 0.
    const origin = row.originIndex ?? 0;
    const destination = row.destinationIndex ?? 0;
    if (row.condition && row.condition !== 'ROUTE_EXISTS') continue;
    seconds[origin]![destination] = parseSeconds(row.duration);
    meters[origin]![destination] = row.distanceMeters ?? 0;
  }
  return { seconds, meters };
}

async function osrmMatrix(points: LatLng[]): Promise<TravelMatrix> {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
  const response = await fetch(
    `${settings.osrmUrl}/table/v1/driving/${coordinates}?annotations=duration,distance`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`OSRM table ${response.status}`);
  const payload = (await response.json()) as {
    code: string;
    durations?: (number | null)[][];
    distances?: (number | null)[][];
  };
  if (payload.code !== 'Ok' || !payload.durations || !payload.distances) {
    throw new Error(`OSRM table returned ${payload.code}`);
  }
  return {
    seconds: payload.durations.map((row) => row.map((value) => value ?? Number.NaN)),
    meters: payload.distances.map((row) => row.map((value) => value ?? Number.NaN)),
  };
}

/** Travel matrix for `points` (index 0 = origin), from the best available provider. */
export async function getTravelMatrix(
  points: LatLng[],
  speedKmh?: number,
): Promise<{ matrix: TravelMatrix; provider: RouteProvider }> {
  const elements = points.length * points.length;
  try {
    if (useGoogle() && elements <= GOOGLE_MAX_ELEMENTS) {
      return { matrix: fillMatrixGaps(await googleMatrix(points), points, speedKmh), provider: 'google' };
    }
    if (settings.routingProvider === 'osrm' && points.length <= OSRM_MAX_POINTS) {
      return { matrix: fillMatrixGaps(await osrmMatrix(points), points, speedKmh), provider: 'osrm' };
    }
  } catch (error) {
    logger.warn('Travel matrix provider failed; using estimates', {
      error: error instanceof Error ? error.message : error,
    });
  }
  return { matrix: buildEstimateMatrix(points, speedKmh), provider: 'estimate' };
}

/** Road geometry through `points` in order, or null when only estimates are available. */
export async function getRoutePolyline(points: LatLng[], provider: RouteProvider): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  try {
    if (provider === 'google' && points.length - 2 <= GOOGLE_MAX_INTERMEDIATES) {
      const response = await fetch(GOOGLE_ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': settings.googleMapsApiKey,
          'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: toWaypoint(points[0]!),
          destination: toWaypoint(points[points.length - 1]!),
          intermediates: points.slice(1, -1).map(toWaypoint),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Routes ${response.status}`);
      const payload = (await response.json()) as {
        routes?: { polyline?: { encodedPolyline?: string } }[];
      };
      const encoded = payload.routes?.[0]?.polyline?.encodedPolyline;
      return encoded ? decodePolyline(encoded) : null;
    }
    if (provider === 'osrm') {
      const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
      const response = await fetch(
        `${settings.osrmUrl}/route/v1/driving/${coordinates}?overview=full&geometries=polyline`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!response.ok) throw new Error(`OSRM route ${response.status}`);
      const payload = (await response.json()) as { routes?: { geometry?: string }[] };
      const geometry = payload.routes?.[0]?.geometry;
      return geometry ? decodePolyline(geometry) : null;
    }
  } catch (error) {
    logger.warn('Route geometry provider failed', { error: error instanceof Error ? error.message : error });
  }
  return null;
}

/** Live drive time between two points; traffic-aware when Google is configured. */
export async function getLiveDriveSeconds(
  from: LatLng,
  to: LatLng,
): Promise<{ seconds: number; meters: number } | null> {
  if (!useGoogle()) return null;
  try {
    const response = await fetch(GOOGLE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': settings.googleMapsApiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: toWaypoint(from),
        destination: toWaypoint(to),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { routes?: { duration?: string; distanceMeters?: number }[] };
    const route = payload.routes?.[0];
    const seconds = parseSeconds(route?.duration);
    return Number.isFinite(seconds) ? { seconds, meters: route?.distanceMeters ?? 0 } : null;
  } catch {
    return null;
  }
}
