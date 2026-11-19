/**
 * Address search. Google Geocoding when a key is configured (best quality), otherwise
 * OpenStreetMap Nominatim, which is free but rate-limited (max 1 request/second, no bulk use).
 */
import {
  isValidLatLng,
  type GeocodeAddressRequest,
  type GeocodeAddressResponse,
  type LatLng,
} from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';

import { settings } from '../../config/runtime';
import { invalidArgument } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireStaff } from '../../lib/guards';

export type GeocodeResult = GeocodeAddressResponse['results'][number];

const USER_AGENT = 'InstaSupply-Dispatch/1.0 (delivery address lookup)';

async function geocodeWithGoogle(query: string, near: LatLng | null): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({ address: query, key: settings.googleMapsApiKey });
  if (near) {
    params.set('bounds', `${near.lat - 0.5},${near.lng - 0.5}|${near.lat + 0.5},${near.lng + 0.5}`);
  }
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  const payload = (await response.json()) as {
    status: string;
    results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
  };
  if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
    throw new Error(`Google geocoding failed: ${payload.status}`);
  }
  return (payload.results ?? []).slice(0, 5).map((result) => ({
    label: result.formatted_address,
    location: { lat: result.geometry.location.lat, lng: result.geometry.location.lng },
  }));
}

let lastNominatimCall = 0;

async function geocodeWithNominatim(query: string, near: LatLng | null): Promise<GeocodeResult[]> {
  // Respect Nominatim's usage policy of at most one request per second per instance.
  const wait = lastNominatimCall + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimCall = Date.now();

  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', addressdetails: '0' });
  if (near) {
    params.set('viewbox', `${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}`);
  }
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Nominatim failed with ${response.status}`);
  const payload = (await response.json()) as { display_name: string; lat: string; lon: string }[];
  return payload.map((item) => ({
    label: item.display_name,
    location: { lat: Number(item.lat), lng: Number(item.lon) },
  }));
}

export async function geocode(query: string, near: LatLng | null = null): Promise<GeocodeResult[]> {
  const mode = settings.geocoder;
  if (mode === 'none') return [];
  const useGoogle = mode === 'google' || (mode === 'auto' && !!settings.googleMapsApiKey);
  try {
    return useGoogle ? await geocodeWithGoogle(query, near) : await geocodeWithNominatim(query, near);
  } catch (error) {
    logger.warn('Geocoding failed', { query, error: error instanceof Error ? error.message : error });
    return [];
  }
}

export async function geocodeFirst(query: string, near: LatLng | null = null): Promise<LatLng | null> {
  const [first] = await geocode(query, near);
  return first?.location ?? null;
}

export const geocodeAddress = callable<GeocodeAddressRequest, GeocodeAddressResponse>(
  'geocodeAddress',
  async (request) => {
    requireStaff(request);
    const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
    if (query.length < 3) invalidArgument('Type at least 3 characters to search.');
    const near = isValidLatLng(request.data?.near) ? request.data.near : null;
    const results = await geocode(query.slice(0, 300), near);
    return { results };
  },
);
