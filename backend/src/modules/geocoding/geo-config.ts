/**
 * Which map providers this process uses (docs/PLATFORM.md §9.6) and the shared provider slots that keep us
 * inside the public OSRM and Nominatim usage policies for all instances together.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import type { Config } from '../../config/env';
import { BUCKETS, hitRateLimit } from '../../platform/http/rate-limit';

export type RoutingMode = 'google' | 'osrm' | 'estimate';
export type GeocoderMode = 'google' | 'nominatim' | 'none';

type GeoConfig = Pick<
  Config,
  'NODE_ENV' | 'ROUTING_PROVIDER' | 'GEOCODER' | 'GOOGLE_MAPS_API_KEY' | 'OSRM_URL' | 'NOMINATIM_URL'
>;

/**
 * `auto`: Google Routes when a key is set, else OSRM at OSRM_URL, else the estimate. A test process never
 * reaches a public server by default: `auto` is the estimate there, and a test that wants a provider names
 * it (its recording `fetch` then answers).
 */
export function routingMode(config: GeoConfig): RoutingMode {
  switch (config.ROUTING_PROVIDER) {
    case 'google':
      return config.GOOGLE_MAPS_API_KEY ? 'google' : 'estimate';
    case 'osrm':
      return config.OSRM_URL ? 'osrm' : 'estimate';
    case 'estimate':
      return 'estimate';
    case 'auto':
      if (config.NODE_ENV === 'test') return 'estimate';
      if (config.GOOGLE_MAPS_API_KEY) return 'google';
      return config.OSRM_URL ? 'osrm' : 'estimate';
  }
}

/** `auto`: Google when the key is set, else Nominatim; `none` answers nothing. Tests: `auto` is `none`. */
export function geocoderMode(config: GeoConfig): GeocoderMode {
  switch (config.GEOCODER) {
    case 'google':
      return config.GOOGLE_MAPS_API_KEY ? 'google' : 'none';
    case 'nominatim':
      return config.NOMINATIM_URL ? 'nominatim' : 'none';
    case 'none':
      return 'none';
    case 'auto':
      if (config.NODE_ENV === 'test') return 'none';
      if (config.GOOGLE_MAPS_API_KEY) return 'google';
      return config.NOMINATIM_URL ? 'nominatim' : 'none';
  }
}

export type ProviderBucket = 'provider_osrm' | 'provider_nominatim';

/** Wall time on purpose: the usage policies are about real seconds, not the business clock of a command. */
const wallClock = { now: () => Date.now() };

/**
 * One slot of a provider bucket (statement (d) of §3.5, autocommit, never inside a transaction). Waits up to
 * `waitMs` for the next window; false when no slot came. Never disabled by RATE_LIMITS_DISABLED: these limits
 * protect the providers, not us.
 */
export async function takeProviderSlot(
  pool: pg.Pool,
  bucket: ProviderBucket,
  waitMs: number,
): Promise<boolean> {
  const { max, windowSeconds } = BUCKETS[bucket];
  const deadline = Date.now() + waitMs;
  for (;;) {
    const result = await hitRateLimit(
      { pool, clock: wallClock, config: { RATE_LIMITS_DISABLED: false } },
      bucket,
      'all',
      max,
      windowSeconds,
    );
    if (result.allowed) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(remaining, Math.max(50, result.retryAfterMs + 10)));
  }
}

/** Provider requests time out after 8 s (the legacy limit). */
export const PROVIDER_TIMEOUT_MS = 8000;
