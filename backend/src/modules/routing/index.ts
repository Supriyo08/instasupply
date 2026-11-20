/**
 * Routing (docs/PLATFORM.md §5.2 optimizeRoute, §5.3.5 routes, §9.3 route.plan and tracking.eta, §9.6; owner
 * `routing`). Other modules enqueue `route.plan` (`applyDeliveryEffects`) and never call the planner directly.
 */
import type { OptimizeRouteRequest, OptimizeRouteResponse, RoutePlan } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../container';
import { requireAuth, requireOperator } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { defineRoute, idParam } from '../../platform/http/route';
import { registerHandler } from '../../platform/outbox/registry';
import { latLngSchema } from '../geocoding';
import { refreshTrackingEta, type TrackingEtaPayload } from './eta';
import { planRoute, summarize } from './planner';
import { findRoute, toRoutePlan } from './routes.repository';

export { planRoute, buildStops, planSignature, pickupStopId, type PlanOptions } from './planner';
export { getTravelMatrix, getRoutePolyline, getLiveDriveSeconds } from './providers';
export { refreshTrackingEta } from './eta';
export { findRoute, toRoutePlan } from './routes.repository';

/** Drivers cannot trigger more than one fresh (possibly paid) plan every 15 seconds. */
export const DRIVER_PLAN_COOLDOWN_MS = 15_000;

const OptimizeRouteSchema = z
  .object({
    driverId: idParam.optional(),
    origin: latLngSchema.nullable().optional(),
  })
  .strict();

const driverParams = z.object({ driverId: idParam });

export function register(app: FastifyInstance, _deps: Deps): void {
  registerHandler<{ driverId: string }>('route.plan', async (payload, { deps }) => {
    if (typeof payload.driverId !== 'string' || payload.driverId === '') return;
    await planRoute(deps, payload.driverId);
  });
  registerHandler<TrackingEtaPayload>('tracking.eta', async (payload, { deps, now }) => {
    if (typeof payload.deliveryId !== 'string' || payload.deliveryId === '') return;
    await refreshTrackingEta(deps, payload.deliveryId, now);
  });

  defineCommand<OptimizeRouteRequest, OptimizeRouteResponse>({
    name: 'optimizeRoute',
    policy: requireOperator,
    schema: OptimizeRouteSchema,
    handler: async (ctx, req, actor) => {
      if (!actor) return permissionDenied();
      const deps = ctx.deps;
      let driverId: string;
      if (actor.isStaff) {
        if (!req.driverId) invalidArgument('Choose a driver to plan a route for.');
        driverId = req.driverId;
        const { rows } = await deps.pool.query<{ role: string | null }>(
          'SELECT role FROM users WHERE id = $1',
          [driverId],
        );
        if (rows[0]?.role !== 'driver') notFound('That driver does not exist.');
      } else {
        if (req.driverId !== undefined && req.driverId !== actor.uid) permissionDenied();
        driverId = actor.uid;
        const current = await findRoute(deps.pool, driverId);
        if (current && deps.clock.now() - current.computed_at < DRIVER_PLAN_COOLDOWN_MS) {
          return summarize(current.doc);
        }
      }
      return planRoute(deps, driverId, { origin: req.origin ?? null, force: true });
    },
  });

  defineRoute<z.infer<typeof driverParams>, Record<string, never>, undefined, RoutePlan>(app, {
    method: 'GET',
    url: '/routes/:driverId',
    policy: requireAuth,
    params: driverParams,
    handler: async (ctx, { params }, actor) => {
      if (!actor?.isStaff && !(actor?.uid === params.driverId && actor.role === 'driver')) permissionDenied();
      const row = await findRoute(ctx.deps.pool, params.driverId);
      return row ? toRoutePlan(row) : notFound('This driver has no planned route yet.');
    },
  });
}
