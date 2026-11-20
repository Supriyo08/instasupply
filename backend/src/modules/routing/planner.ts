/**
 * Plans a driver's route (docs/PLATFORM.md §9.6, MARKETPLACE §5.11; port of legacy/…/routing/planner.ts).
 *
 * 1. Plain reads, no transaction: the driver's active deliveries with their `updated_at`, the live position,
 *    the driver's class.
 * 2. Provider calls, no transaction open: travel matrix, `optimizeStops`, road geometry.
 * 3. One short transaction: the deliveries are re-read `FOR SHARE`; the plan is stored in `routes` and
 *    `stopsBefore` is patched onto the tracking document of every delivery that did not change meanwhile.
 *    A changed delivery already enqueued a newer `route.plan`, so its patch (and the plan's signature) is
 *    skipped. The planner never writes status, phase or any other field of a delivery transaction.
 */
import { createHash } from 'node:crypto';
import {
  ACTIVE_STATUSES,
  VEHICLE_CLASSES,
  centerOf,
  optimizeStops,
  simplifyPath,
  type Delivery,
  type LatLng,
  type OptimizeRouteResponse,
  type OptimizerStop,
  type RoutePlan,
  type RouteStop,
  type VehicleClass,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import { withTransaction } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';
import { lockTrackingByDelivery, patchTracking } from '../tracking';
import { getRoutePolyline, getTravelMatrix } from './providers';
import { findRoute, type RouteRow } from './routes.repository';

export interface PlanOptions {
  /** The point the driver starts from; defaults to the live position. */
  origin?: LatLng | null;
  /** Recompute even when the planning inputs are unchanged (optimizeRoute). */
  force?: boolean;
}

interface DeliveryRow {
  id: string;
  doc: Omit<Delivery, 'id' | 'createdAt' | 'updatedAt'>;
  created_at: number;
  updated_at: number;
}

/** A plan's stop before optimisation: what the optimizer needs plus what the RouteStop shows. */
interface PlannedStop {
  optimizer: OptimizerStop;
  stop: Omit<RouteStop, 'legSeconds' | 'legMeters' | 'arrivalOffsetSeconds'>;
}

const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

export const pickupStopId = (deliveryId: string): string => `${deliveryId}:pickup`;

/** An `assigned` or `accepted` marketplace delivery whose load is still at the store (§5.11). */
const needsPickup = (delivery: Delivery): boolean =>
  delivery.pickup !== null &&
  delivery.pickup.collectedAt === null &&
  (delivery.status === 'assigned' || delivery.status === 'accepted');

/** Builds the stops of MARKETPLACE §5.11: a pickup then a drop-off for an uncollected job, else a drop-off. */
export function buildStops(deliveries: readonly Delivery[], driverClass: VehicleClass | null): PlannedStop[] {
  const stops: PlannedStop[] = [];
  for (const delivery of deliveries) {
    const pickup = needsPickup(delivery) ? delivery.pickup : null;
    if (pickup) {
      const loadClass = delivery.vehicleClass ?? driverClass;
      stops.push({
        optimizer: {
          id: pickupStopId(delivery.id),
          location: pickup.location,
          priority: delivery.priority,
          windowStart: pickup.readyBy,
          windowEnd: null,
          serviceSeconds: loadClass ? VEHICLE_CLASSES[loadClass].loadMinutes * 60 : undefined,
        },
        stop: {
          deliveryId: delivery.id,
          kind: 'pickup',
          title: pickup.storeName,
          orderId: delivery.orderId,
          customerName: delivery.customer.name,
          address: pickup.address,
          location: pickup.location,
          status: delivery.status,
          priority: delivery.priority,
        },
      });
    }
    stops.push({
      optimizer: {
        id: delivery.id,
        location: delivery.location,
        priority: delivery.priority,
        windowStart: delivery.windowStart ?? null,
        windowEnd: delivery.windowEnd ?? null,
        ...(pickup ? { after: pickupStopId(delivery.id) } : {}),
      },
      stop: {
        deliveryId: delivery.id,
        kind: 'dropoff',
        title: delivery.customer.name,
        orderId: delivery.orderId,
        customerName: delivery.customer.name,
        address: delivery.address,
        location: delivery.location,
        status: delivery.status,
        priority: delivery.priority,
      },
    });
  }
  return stops;
}

/** The stop being driven to stays first: the drop-off in transit, or the store the driver is standing at. */
function lockedFirstId(deliveries: readonly Delivery[]): string | null {
  const driving = deliveries.find((d) => d.status === 'in_transit' || d.status === 'arrived');
  if (driving) return driving.id;
  const atStore = deliveries.find((d) => needsPickup(d) && d.pickup?.arrivedAt != null);
  return atStore ? pickupStopId(atStore.id) : null;
}

/** Hash of the planning inputs. ~100 m of GPS movement does not warrant a new automatic plan. */
export function planSignature(
  deliveries: readonly Delivery[],
  origin: LatLng | null,
  driverClass: VehicleClass | null,
): string {
  const stops = deliveries
    .map((d) => [
      d.id,
      d.status,
      round(d.location.lat, 5),
      round(d.location.lng, 5),
      d.priority,
      d.windowStart ?? null,
      d.windowEnd ?? null,
      d.vehicleClass ?? null,
      d.pickup
        ? [
            round(d.pickup.location.lat, 5),
            round(d.pickup.location.lng, 5),
            d.pickup.readyBy,
            d.pickup.arrivedAt !== null,
            d.pickup.collectedAt !== null,
          ]
        : null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const roundedOrigin = origin ? [round(origin.lat, 3), round(origin.lng, 3)] : null;
  return createHash('sha1').update(JSON.stringify({ stops, roundedOrigin, driverClass })).digest('hex');
}

export const summarize = (
  plan: Pick<RoutePlan, 'stops' | 'totalSeconds' | 'totalMeters' | 'provider'> | null,
) =>
  ({
    stops: plan?.stops.length ?? 0,
    totalSeconds: plan?.totalSeconds ?? 0,
    totalMeters: plan?.totalMeters ?? 0,
    provider: plan?.provider ?? 'estimate',
  }) satisfies OptimizeRouteResponse;

type PlanDeps = Pick<Deps, 'config' | 'pool' | 'clock' | 'log' | 'hooks'>;

/** Plans and stores the route of one driver. Runs in the `route.plan` handler and in `optimizeRoute`. */
export async function planRoute(
  deps: PlanDeps,
  driverId: string,
  options: PlanOptions = {},
): Promise<OptimizeRouteResponse> {
  const now = deps.clock.now();
  const [deliveryResult, locationResult, profileResult, stored] = await Promise.all([
    deps.pool.query<DeliveryRow>(
      `SELECT id, doc, created_at, updated_at FROM deliveries
        WHERE driver_id = $1 AND status = ANY($2::text[]) ORDER BY id`,
      [driverId, ACTIVE_STATUSES],
    ),
    deps.pool.query<{ lat: number; lng: number }>(
      'SELECT lat, lng FROM driver_locations WHERE driver_id = $1',
      [driverId],
    ),
    deps.pool.query<{ capacity_class: VehicleClass | null }>(
      'SELECT capacity_class FROM users WHERE id = $1',
      [driverId],
    ),
    findRoute(deps.pool, driverId),
  ]);
  if (!profileResult.rows[0]) return summarize(null);

  const read = deliveryResult.rows;
  const deliveries: Delivery[] = read.map((row) => ({
    id: row.id,
    ...row.doc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const live = locationResult.rows[0] ?? null;
  const origin = options.origin ?? (live ? { lat: live.lat, lng: live.lng } : null);
  const driverClass = profileResult.rows[0].capacity_class;
  const signature = planSignature(deliveries, origin, driverClass);
  if (!options.force && stored && stored.signature === signature) return summarize(toPlanSummary(stored));

  const planned = buildStops(deliveries, driverClass);
  const speedKmh = driverClass ? VEHICLE_CLASSES[driverClass].speedKmh : undefined;
  let plan: Omit<RoutePlan, 'driverId' | 'computedAt'>;
  if (planned.length === 0) {
    plan = { origin, stops: [], totalSeconds: 0, totalMeters: 0, polyline: [], provider: 'estimate' };
  } else {
    const start = origin ?? centerOf(planned.map((p) => p.optimizer.location))!;
    const points = [start, ...planned.map((p) => p.optimizer.location)];
    const { matrix, provider } = await getTravelMatrix(deps, points, speedKmh);
    const optimized = optimizeStops(
      planned.map((p) => p.optimizer),
      matrix,
      { startTime: now, lockedFirstId: lockedFirstId(deliveries) },
    );
    const stops: RouteStop[] = optimized.legs.map((leg) => ({
      ...planned[leg.stopIndex]!.stop,
      legSeconds: Math.round(leg.legSeconds),
      legMeters: Math.round(leg.legMeters),
      arrivalOffsetSeconds: Math.round(leg.arrivalOffsetSeconds),
    }));
    const path = [start, ...stops.map((stop) => stop.location)];
    const geometry = (await getRoutePolyline(deps, path, provider)) ?? path;
    plan = {
      origin,
      stops,
      totalSeconds: Math.round(optimized.totalSeconds),
      totalMeters: Math.round(optimized.totalMeters),
      polyline: simplifyPath(geometry, 600),
      provider,
    };
  }

  await deps.hooks.at('planRoute:beforeWrite');
  await storePlan(deps, driverId, plan, signature, read, now);
  deps.log.info({ driverId, stops: plan.stops.length, provider: plan.provider }, 'route planned');
  return summarize(plan);
}

const toPlanSummary = (row: RouteRow) => ({
  stops: row.doc.stops,
  totalSeconds: row.doc.totalSeconds,
  totalMeters: row.doc.totalMeters,
  provider: row.doc.provider,
});

/** Step 3: the staleness check and the field ownership of §9.4, in one short transaction. */
async function storePlan(
  deps: PlanDeps,
  driverId: string,
  plan: Omit<RoutePlan, 'driverId' | 'computedAt'>,
  signature: string,
  read: readonly DeliveryRow[],
  now: number,
): Promise<void> {
  await withTransaction(
    deps,
    async (tx) => {
      const ids = read.map((row) => row.id);
      const { rows: current } = await tx.query<{ id: string; updated_at: number }>(
        `SELECT id, updated_at FROM deliveries WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" FOR SHARE`,
        [ids],
      );
      const currentAt = new Map(current.map((row) => [row.id, row.updated_at]));
      const unchanged = new Set(
        read.filter((row) => currentAt.get(row.id) === row.updated_at).map((r) => r.id),
      );
      const stale = unchanged.size !== read.length;

      await tx.query(
        `INSERT INTO routes (driver_id, doc, signature, leased_at, computed_at)
         VALUES ($1, $2::jsonb, $3, NULL, $4)
         ON CONFLICT (driver_id) DO UPDATE SET doc = EXCLUDED.doc, signature = EXCLUDED.signature,
           leased_at = NULL, computed_at = EXCLUDED.computed_at`,
        [driverId, JSON.stringify(plan), stale ? null : signature, new Date(now)],
      );
      await publishChange(tx, 'routes', 'updated', { driverId });

      // stopsBefore: how many stops the driver makes before this delivery's drop-off (§5.11).
      const stopsBefore = new Map<string, number>();
      plan.stops.forEach((stop, index) => {
        if (stop.kind === 'dropoff') stopsBefore.set(stop.deliveryId, index);
      });
      for (const tracking of await lockTrackingByDelivery(tx, [...unchanged])) {
        await patchTracking(tx, tracking, { stopsBefore: stopsBefore.get(tracking.delivery_id) ?? null });
      }
    },
    { now },
  );
}
