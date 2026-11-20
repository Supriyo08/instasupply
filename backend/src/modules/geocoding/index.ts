/**
 * Geocoding (docs/PLATFORM.md §9.6, owner `routing`): the public `geocodeAddress` command and the `geocode`
 * helpers other modules call (for example `createDeliveries`, before its transaction).
 */
import type { GeocodeAddressRequest, GeocodeAddressResponse } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../container';
import { publicPolicy } from '../../platform/auth/policies';
import { hmacHex } from '../../platform/crypto';
import { defineCommand } from '../../platform/http/command';
import { use } from '../../platform/http/rate-limit';
import { geocode } from './geocoder';

export { geocode, geocodeFirst, geocodeCacheKey, cityIdFor, type GeocodeResult } from './geocoder';
export {
  routingMode,
  geocoderMode,
  takeProviderSlot,
  PROVIDER_TIMEOUT_MS,
  type RoutingMode,
  type GeocoderMode,
} from './geo-config';

/** A finite latitude and longitude in range. */
export const latLngSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .strict();

const GeocodeAddressSchema = z
  .object({
    query: z
      .string()
      .max(2000)
      .transform((value) => value.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(3, 'Type at least 3 characters to search.'))
      .transform((value) => value.slice(0, 300)),
    near: latLngSchema.nullable().optional(),
  })
  .strict();

/** The parsed request: the shared contract with the query normalised. */
type GeocodeAddressInput = z.infer<typeof GeocodeAddressSchema> & GeocodeAddressRequest;

export function register(_app: FastifyInstance, _deps: Deps): void {
  defineCommand<GeocodeAddressInput, GeocodeAddressResponse>({
    name: 'geocodeAddress',
    policy: publicPolicy,
    schema: GeocodeAddressSchema,
    // Staff search freely; everyone else 30 per hour, per account or, signed out, per (hashed) address.
    limits: (ctx) =>
      ctx.actor?.isStaff ? [] : [use('geocode', ctx.actor ? ctx.actor.uid : hmacHex('ip', ctx.ip))],
    handler: async (ctx, req) => ({ results: await geocode(ctx.deps, req.query, req.near ?? null) }),
  });
}
