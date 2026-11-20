/**
 * Travel-time providers (docs/PLATFORM.md §9.6; port of legacy/…/routing/providers.ts). Google Routes when a
 * key is configured, OSRM otherwise, the straight-line estimate always as the fallback. Every call here
 * happens with no transaction open.
 */
import {
  buildEstimateMatrix,
  decodePolyline,
  fillMatrixGaps,
  type LatLng,
  type RouteProvider,
  type TravelMatrix,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import { PROVIDER_TIMEOUT_MS, routingMode, takeProviderSlot } from '../geocoding';

type ProviderDeps = Pick<Deps, 'config' | 'pool' | 'log'>;

const GOOGLE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Google: 100 matrix elements with TRAFFIC_AWARE_OPTIMAL, 625 with TRAFFIC_AWARE, 25 intermediates. */
export const GOOGLE_OPTIMAL_MAX_ELEMENTS = 100;
export const GOOGLE_MAX_ELEMENTS = 625;
export const GOOGLE_MAX_INTERMEDIATES = 25;
export const OSRM_MAX_POINTS = 100;
/** The route geometry may wait this long for an OSRM slot; the matrix never waits (no slot → estimate). */
const OSRM_GEOMETRY_WAIT_MS = 1500;

const toWaypoint = (point: LatLng) => ({
  location: { latLng: { latitude: point.lat, longitude: point.lng } },
});

const parseSeconds = (value: string | undefined): number =>
  value ? Number.parseFloat(value.replace('s', '')) : Number.NaN;

const osrmCoordinates = (points: readonly LatLng[]): string =>
  points.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');

const osrmHeaders = (deps: ProviderDeps) => ({ 'User-Agent': deps.config.GEO_USER_AGENT });

interface GoogleMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
}

async function googleMatrix(deps: ProviderDeps, points: readonly LatLng[]): Promise<TravelMatrix> {
  const elements = points.length * points.length;
  const response = await globalThis.fetch(GOOGLE_MATRIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': deps.config.GOOGLE_MAPS_API_KEY ?? '',
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify({
      origins: points.map((point) => ({ waypoint: toWaypoint(point) })),
      destinations: points.map((point) => ({ waypoint: toWaypoint(point) })),
      travelMode: 'DRIVE',
      routingPreference: elements <= GOOGLE_OPTIMAL_MAX_ELEMENTS ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE',
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
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
    if (origin >= size || destination >= size) continue;
    seconds[origin]![destination] = parseSeconds(row.duration);
    meters[origin]![destination] = row.distanceMeters ?? 0;
  }
  return { seconds, meters };
}

async function osrmMatrix(deps: ProviderDeps, points: readonly LatLng[]): Promise<TravelMatrix> {
  const response = await globalThis.fetch(
    `${deps.config.OSRM_URL}/table/v1/driving/${osrmCoordinates(points)}?annotations=duration,distance`,
    { headers: osrmHeaders(deps), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) },
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

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Travel matrix for `points` (index 0 = origin) from the best available provider; never throws. */
export async function getTravelMatrix(
  deps: ProviderDeps,
  points: readonly LatLng[],
  speedKmh?: number,
): Promise<{ matrix: TravelMatrix; provider: RouteProvider }> {
  const mode = routingMode(deps.config);
  const list = [...points];
  try {
    if (mode === 'google' && list.length * list.length <= GOOGLE_MAX_ELEMENTS) {
      return { matrix: fillMatrixGaps(await googleMatrix(deps, list), list, speedKmh), provider: 'google' };
    }
    if (mode === 'osrm' && list.length <= OSRM_MAX_POINTS && list.length >= 2) {
      if (await takeProviderSlot(deps.pool, 'provider_osrm', 0)) {
        return { matrix: fillMatrixGaps(await osrmMatrix(deps, list), list, speedKmh), provider: 'osrm' };
      }
      deps.log.info({ provider: 'osrm' }, 'no OSRM slot; using estimates');
    }
  } catch (error) {
    deps.log.warn(
      { provider: mode, err: errorText(error) },
      'travel matrix provider failed; using estimates',
    );
  }
  return { matrix: buildEstimateMatrix(list, speedKmh), provider: 'estimate' };
}

/** Road geometry through `points` in order, or null when only estimates are available. Never throws. */
export async function getRoutePolyline(
  deps: ProviderDeps,
  points: readonly LatLng[],
  provider: RouteProvider,
): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  try {
    if (provider === 'google' && points.length - 2 <= GOOGLE_MAX_INTERMEDIATES) {
      const response = await globalThis.fetch(GOOGLE_ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': deps.config.GOOGLE_MAPS_API_KEY ?? '',
          'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: toWaypoint(points[0]!),
          destination: toWaypoint(points[points.length - 1]!),
          intermediates: points.slice(1, -1).map(toWaypoint),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Routes ${response.status}`);
      const payload = (await response.json()) as { routes?: { polyline?: { encodedPolyline?: string } }[] };
      const encoded = payload.routes?.[0]?.polyline?.encodedPolyline;
      return encoded ? decodePolyline(encoded) : null;
    }
    if (provider === 'osrm' && points.length <= OSRM_MAX_POINTS) {
      if (!(await takeProviderSlot(deps.pool, 'provider_osrm', OSRM_GEOMETRY_WAIT_MS))) return null;
      const response = await globalThis.fetch(
        `${deps.config.OSRM_URL}/route/v1/driving/${osrmCoordinates(points)}?overview=full&geometries=polyline`,
        { headers: osrmHeaders(deps), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) },
      );
      if (!response.ok) throw new Error(`OSRM route ${response.status}`);
      const payload = (await response.json()) as { routes?: { geometry?: string }[] };
      const geometry = payload.routes?.[0]?.geometry;
      return geometry ? decodePolyline(geometry) : null;
    }
  } catch (error) {
    deps.log.warn({ provider, err: errorText(error) }, 'route geometry provider failed');
  }
  return null;
}

/** One live drive time between two points from the configured provider, or null (estimate mode, failure). */
export async function getLiveDriveSeconds(
  deps: ProviderDeps,
  from: LatLng,
  to: LatLng,
): Promise<{ seconds: number; meters: number } | null> {
  const mode = routingMode(deps.config);
  try {
    if (mode === 'google') {
      const response = await globalThis.fetch(GOOGLE_ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': deps.config.GOOGLE_MAPS_API_KEY ?? '',
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        body: JSON.stringify({
          origin: toWaypoint(from),
          destination: toWaypoint(to),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        routes?: { duration?: string; distanceMeters?: number }[];
      };
      const route = payload.routes?.[0];
      const seconds = parseSeconds(route?.duration);
      return Number.isFinite(seconds) ? { seconds, meters: route?.distanceMeters ?? 0 } : null;
    }
    if (mode === 'osrm') {
      if (!(await takeProviderSlot(deps.pool, 'provider_osrm', 0))) return null;
      const response = await globalThis.fetch(
        `${deps.config.OSRM_URL}/route/v1/driving/${osrmCoordinates([from, to])}?overview=false`,
        { headers: osrmHeaders(deps), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        code?: string;
        routes?: { duration?: number; distance?: number }[];
      };
      const route = payload.routes?.[0];
      return payload.code === 'Ok' && typeof route?.duration === 'number'
        ? { seconds: route.duration, meters: route.distance ?? 0 }
        : null;
    }
  } catch (error) {
    deps.log.warn({ provider: mode, err: errorText(error) }, 'live ETA provider failed');
  }
  return null;
}
