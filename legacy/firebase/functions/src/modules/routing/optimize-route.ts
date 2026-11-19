import {
  isValidLatLng,
  toMillis,
  type OptimizeRouteRequest,
  type OptimizeRouteResponse,
  type RoutePlan,
} from '@instasupply/shared';

import { callable } from '../../lib/functions';
import { requireOperator, requireString } from '../../lib/guards';
import { planRoute, routeRef } from './planner';

/** Drivers can't trigger more than one fresh (possibly paid) plan every 15 seconds. */
const DRIVER_COOLDOWN_MS = 15_000;

export const optimizeRoute = callable<OptimizeRouteRequest, OptimizeRouteResponse>(
  'optimizeRoute',
  async (request) => {
    const actor = requireOperator(request);
    const driverId = actor.isStaff ? requireString(request.data?.driverId, 'Driver') : actor.uid;
    const origin = isValidLatLng(request.data?.origin) ? request.data.origin : null;

    if (!actor.isStaff) {
      const current = (await routeRef(driverId).get()).data() as Partial<RoutePlan> | undefined;
      const computedAt = toMillis(current?.computedAt);
      if (current && computedAt && Date.now() - computedAt < DRIVER_COOLDOWN_MS) {
        return {
          stops: current.stops?.length ?? 0,
          totalSeconds: current.totalSeconds ?? 0,
          totalMeters: current.totalMeters ?? 0,
          provider: current.provider ?? 'estimate',
        };
      }
    }

    return planRoute(driverId, { origin, force: true });
  },
);
