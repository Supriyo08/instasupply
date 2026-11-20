/**
 * Address search (docs/PLATFORM.md §9.6, port of legacy/…/geocoding/geocoder.ts). Google Geocoding when a key
 * is configured, otherwise OpenStreetMap Nominatim under its usage policy: one request per second for all
 * instances together, an identifying User-Agent, every answer cached, no autocomplete. Results are biased to
 * the Greater Toronto Area and enriched with the fields a jobsite needs.
 */
import {
  CITIES,
  CITY_IDS,
  SERVICE_AREA,
  haversineMeters,
  isValidLatLng,
  nearestCity,
  type CityId,
  type GeocodeAddressResponse,
  type LatLng,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import { sha256Hex } from '../../platform/crypto';
import { ApiError } from '../../platform/http/errors';
import { PROVIDER_TIMEOUT_MS, geocoderMode, takeProviderSlot, type GeocoderMode } from './geo-config';

export type GeocodeResult = GeocodeAddressResponse['results'][number];

/** Geocode results are kept 30 days (§9.6). */
export const GEOCODE_CACHE_DAYS = 30;
/** How long a request waits for a Nominatim slot before it gives up (§9.6). */
export const NOMINATIM_SLOT_WAIT_MS = 3000;
const MAX_RESULTS = 5;

type GeocodeDeps = Pick<Deps, 'config' | 'pool' | 'clock' | 'log'>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** SHA-256 of provider, the lower-cased trimmed query and the bias point rounded to 2 decimals. */
export function geocodeCacheKey(provider: GeocoderMode, query: string, near: LatLng | null): string {
  const bias = near ? `${round2(near.lat).toFixed(2)},${round2(near.lng).toFixed(2)}` : '-';
  return sha256Hex(`${provider}\n${query.trim().toLowerCase()}\n${bias}`);
}

// ---------- enrichment ----------

const CITY_BY_NAME = new Map<string, CityId>(CITY_IDS.map((id) => [CITIES[id].name.toLowerCase(), id]));

/** The municipality when it is one of the 15 cities, else the nearest one to the point (MARKETPLACE §1.5). */
export function cityIdFor(city: string | null, location: LatLng): CityId {
  if (city) {
    const name = city
      .trim()
      .toLowerCase()
      .replace(/^(city|town) of /, '');
    const match = CITY_BY_NAME.get(name);
    if (match) return match;
  }
  return nearestCity(location);
}

const clip = (value: string | null | undefined, max: number): string | null => {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text ? text.slice(0, max) : null;
};

function enrich(input: {
  label: string;
  location: LatLng;
  line1: string | null;
  city: string | null;
  postalCode: string | null;
  area: string | null;
}): GeocodeResult {
  const cityId = cityIdFor(input.city, input.location);
  return {
    label: clip(input.label, 300) ?? `${input.location.lat.toFixed(5)}, ${input.location.lng.toFixed(5)}`,
    location: { lat: input.location.lat, lng: input.location.lng },
    line1: clip(input.line1, 160),
    city: clip(input.city, 60),
    postalCode: input.postalCode ? input.postalCode.toUpperCase().replace(/\s+/g, ' ').trim() : null,
    cityId,
    areaLabel: clip(input.area, 80) ?? CITIES[cityId].name,
  };
}

// ---------- Google ----------

interface GoogleComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
interface GoogleResult {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components?: GoogleComponent[];
}

function fromGoogle(result: GoogleResult): GeocodeResult | null {
  const location = { lat: result.geometry.location.lat, lng: result.geometry.location.lng };
  if (!isValidLatLng(location)) return null;
  const parts = result.address_components ?? [];
  const part = (...types: string[]): string | null =>
    parts.find((component) => types.some((type) => component.types.includes(type)))?.long_name ?? null;
  const number = part('street_number');
  const route = part('route');
  return enrich({
    label: result.formatted_address,
    location,
    line1: route ? [number, route].filter(Boolean).join(' ') : null,
    city: part('locality', 'postal_town', 'administrative_area_level_3'),
    postalCode: part('postal_code'),
    area: part('neighborhood', 'sublocality_level_1', 'sublocality'),
  });
}

async function geocodeWithGoogle(deps: GeocodeDeps, query: string): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    address: query,
    key: deps.config.GOOGLE_MAPS_API_KEY ?? '',
    components: 'country:CA',
    bounds: `${SERVICE_AREA.south},${SERVICE_AREA.west}|${SERVICE_AREA.north},${SERVICE_AREA.east}`,
    region: 'ca',
  });
  const response = await globalThis.fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const payload = (await response.json()) as { status: string; results?: GoogleResult[] };
  if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
    throw new Error(`Google geocoding failed: ${payload.status}`);
  }
  return (payload.results ?? [])
    .map(fromGoogle)
    .filter((r): r is GeocodeResult => r !== null)
    .slice(0, MAX_RESULTS);
}

// ---------- Nominatim ----------

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string | undefined>;
}

function fromNominatim(item: NominatimItem): GeocodeResult | null {
  const location = { lat: Number(item.lat), lng: Number(item.lon) };
  if (!isValidLatLng(location)) return null;
  const a = item.address ?? {};
  const road = a.road ?? a.pedestrian ?? a.street ?? null;
  return enrich({
    label: item.display_name,
    location,
    line1: road ? [a.house_number, road].filter(Boolean).join(' ') : null,
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
    postalCode: a.postcode ?? null,
    area: a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district ?? null,
  });
}

async function geocodeWithNominatim(deps: GeocodeDeps, query: string): Promise<GeocodeResult[]> {
  if (!(await takeProviderSlot(deps.pool, 'provider_nominatim', NOMINATIM_SLOT_WAIT_MS))) {
    throw new ApiError('unavailable', 'Address search is busy. Please try again in a moment.', null, {
      retryAfterMs: 1000,
    });
  }
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(MAX_RESULTS),
    countrycodes: 'ca',
    viewbox: `${SERVICE_AREA.west},${SERVICE_AREA.north},${SERVICE_AREA.east},${SERVICE_AREA.south}`,
    bounded: '1',
    addressdetails: '1',
  });
  const response = await globalThis.fetch(`${deps.config.NOMINATIM_URL}/search?${params}`, {
    headers: { 'User-Agent': deps.config.GEO_USER_AGENT, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Nominatim failed with ${response.status}`);
  const payload = (await response.json()) as NominatimItem[];
  return (Array.isArray(payload) ? payload : [])
    .map(fromNominatim)
    .filter((r): r is GeocodeResult => r !== null)
    .slice(0, MAX_RESULTS);
}

// ---------- cache and entry points ----------

async function readCache(deps: GeocodeDeps, key: string, now: number): Promise<GeocodeResult[] | null> {
  const { rows } = await deps.pool.query<{ results: GeocodeResult[] }>(
    'SELECT results FROM geocode_cache WHERE query_key = $1 AND expires_at > $2',
    [key, new Date(now)],
  );
  return rows[0]?.results ?? null;
}

async function writeCache(
  deps: GeocodeDeps,
  key: string,
  provider: GeocoderMode,
  results: GeocodeResult[],
  now: number,
): Promise<void> {
  await deps.pool.query(
    `INSERT INTO geocode_cache (query_key, provider, results, created_at, expires_at)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (query_key) DO UPDATE SET results = EXCLUDED.results, created_at = EXCLUDED.created_at,
       expires_at = EXCLUDED.expires_at`,
    [key, provider, JSON.stringify(results), new Date(now), new Date(now + GEOCODE_CACHE_DAYS * 86_400_000)],
  );
}

/**
 * GTA-biased address search. Never runs inside a transaction (it may wait for a provider slot and call the
 * network). A provider failure answers no results and is not cached; a cache hit costs no provider call and
 * no provider slot. Throws `unavailable` only when Nominatim had no free slot for 3 s.
 */
export async function geocode(
  deps: GeocodeDeps,
  query: string,
  near: LatLng | null = null,
): Promise<GeocodeResult[]> {
  const provider = geocoderMode(deps.config);
  const text = query.trim().slice(0, 300);
  if (provider === 'none' || text.length === 0) return [];
  const now = deps.clock.now();
  const key = geocodeCacheKey(provider, text, near);
  const cached = await readCache(deps, key, now);
  const order = (results: GeocodeResult[]): GeocodeResult[] =>
    near
      ? [...results].sort((a, b) => haversineMeters(a.location, near) - haversineMeters(b.location, near))
      : results;
  if (cached) return order(cached);

  let results: GeocodeResult[];
  try {
    results =
      provider === 'google' ? await geocodeWithGoogle(deps, text) : await geocodeWithNominatim(deps, text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    deps.log.warn(
      { provider, err: error instanceof Error ? error.message : String(error) },
      'geocoding failed',
    );
    return [];
  }
  await writeCache(deps, key, provider, results, now);
  return order(results);
}

/** The first result's position, or null. For server-side callers such as `createDeliveries`. */
export async function geocodeFirst(
  deps: GeocodeDeps,
  query: string,
  near: LatLng | null = null,
): Promise<LatLng | null> {
  try {
    const [first] = await geocode(deps, query, near);
    return first?.location ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 'unavailable') return null;
    throw error;
  }
}
