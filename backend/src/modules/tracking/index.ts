/**
 * Tracking (docs/PLATFORM.md §5.3.3, §5.3.5, §9.4; owner `routing`): the public tracking document, driver
 * locations and POST /me/location. `syncTracking` is the §9.1 helper delivery transactions call.
 */
import type { DriverLocation, LocationAck, Page, PublicTracking, WithId } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../container';
import { requireActiveDriver, requireAuth, requireStaff } from '../../platform/auth/policies';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { LocationReportSchema, reportLocation } from './location';
import {
  LOCATION_COLUMNS,
  TRACKING_TOKEN,
  findDriverLocation,
  findTrackingByToken,
  toDriverLocation,
  type DriverLocationRow,
} from './tracking.repository';

export { syncTracking, estimateEta, vehicleLabel, isLiveStatus } from './tracking-service';
export { reportLocation } from './location';
export {
  lockTrackingByDelivery,
  patchTracking,
  publishTracking,
  findDriverLocation,
  toPublicTracking,
  type TrackingDoc,
  type TrackingRow,
  type DriverLocationRow,
} from './tracking.repository';

const tokenParams = z.object({ token: z.string().regex(TRACKING_TOKEN, 'That tracking link is not valid.') });
const driverParams = z.object({ driverId: idParam });
const locationsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(500),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();

export function register(app: FastifyInstance, _deps: Deps): void {
  defineRoute<z.infer<typeof tokenParams>, Record<string, never>, undefined, PublicTracking>(app, {
    method: 'GET',
    url: '/tracking/:token',
    policy: 'public',
    params: tokenParams,
    handler: async (ctx, { params }) =>
      (await findTrackingByToken(ctx.deps.pool, params.token)) ??
      notFound('This tracking link is not valid or has expired.'),
  });

  defineRoute<Record<string, never>, z.infer<typeof locationsQuery>, undefined, Page<WithId<DriverLocation>>>(
    app,
    {
      method: 'GET',
      url: '/driver-locations',
      policy: requireStaff,
      query: locationsQuery,
      handler: async (ctx, { query }) => {
        const values: unknown[] = [query.limit + 1];
        let where = '';
        if (query.cursor) {
          const [at, id] = decodeCursor(query.cursor);
          if (typeof at !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
          values.push(new Date(at), id);
          where = 'WHERE (updated_at, driver_id) < ($2, $3)';
        }
        const { rows } = await ctx.deps.pool.query<DriverLocationRow>(
          `SELECT ${LOCATION_COLUMNS} FROM driver_locations ${where}
            ORDER BY updated_at DESC, driver_id DESC LIMIT $1`,
          values,
        );
        return readPage(rows, query.limit, toDriverLocation, (row) => [row.updated_at, row.driver_id]);
      },
    },
  );

  defineRoute<z.infer<typeof driverParams>, Record<string, never>, undefined, WithId<DriverLocation>>(app, {
    method: 'GET',
    url: '/driver-locations/:driverId',
    policy: requireAuth,
    params: driverParams,
    handler: async (ctx, { params }, actor) => {
      if (!actor?.isStaff && actor?.uid !== params.driverId) permissionDenied();
      const row = await findDriverLocation(ctx.deps.pool, params.driverId);
      return row ? toDriverLocation(row) : notFound('This driver has not shared a location yet.');
    },
  });

  defineRoute<
    Record<string, never>,
    Record<string, never>,
    z.infer<typeof LocationReportSchema>,
    LocationAck
  >(app, {
    method: 'POST',
    url: '/me/location',
    policy: requireActiveDriver,
    body: LocationReportSchema,
    handler: async (ctx, { body }) =>
      reportLocation(ctx.deps, requireActiveDriver(ctx).uid, body, ctx.deps.clock.now()),
  });
}
