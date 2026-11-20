/**
 * Delivery data for the driver screens (docs/CLIENTS.md §3.3, §4.6). Every hook is one descriptor of
 * `queries` (§4.1); screens never build a request themselves.
 */
import {
  localDateOf,
  startOfLocalDay,
  toMillis,
  type Delivery,
  type LatLng,
  type RoutePlan,
  type RouteStop,
} from '@instasupply/shared';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import { useMemo } from 'react';

import { queries } from '@/lib/api';
import { useNow } from '@/lib/use-now';

/** Assigned to the driver and not finished: `assigned`, `accepted`, `picked_up`, `in_transit`, `arrived`. */
export function useActiveDeliveries(uid: string) {
  return useLiveQuery(queries.driverActiveDeliveries(uid));
}

/**
 * A route plan the screens can trust, or null. A plan without a `stops` array (a document the planner
 * has started but not finished, or any other partial shape) counts as no plan, so no screen can throw
 * on `plan.stops` (code review R56, R61). The guard sits here, once, for every reader.
 */
export function normalizeRoutePlan(plan: RoutePlan | null | undefined): RoutePlan | null {
  if (!plan || !Array.isArray(plan.stops)) return null;
  return Array.isArray(plan.polyline) ? plan : { ...plan, polyline: [] };
}

export function useRoutePlan(uid: string) {
  const result = useLiveQuery(queries.route(uid));
  const data = useMemo(() => normalizeRoutePlan(result.data), [result.data]);
  return { ...result, data };
}

export function useDelivery(id: string | undefined) {
  return useLiveQuery(queries.delivery(id));
}

/** Newest first, at most 30. */
export function useDeliveryEvents(id: string | undefined) {
  return useLiveQuery(queries.deliveryEvents(id));
}

/** Delivered, failed and cancelled jobs, newest first, paged. */
export function useDeliveryHistory(uid: string) {
  return usePagedQuery(queries.driverHistory(uid));
}

/** Delivered and failed since the start of today (Toronto), counted by the server. Null while loading. */
export function useDeliveredToday(uid: string): { delivered: number; failed: number } | null {
  const now = useNow(60_000);
  const since = startOfLocalDay(localDateOf(now));
  const stats = useLiveQuery(queries.deliveryStats(uid, since));
  return stats.updatedAt === null ? null : stats.data;
}

/** One stop of the driver's day: a delivery has a pickup (until the load is collected) and a drop-off. */
export interface PlannedStop {
  /** `${deliveryId}:${kind}`: unique per stop. */
  key: string;
  kind: RouteStop['kind'];
  delivery: Delivery;
  /** The planner's stop, or null when the plan does not know the delivery yet (just claimed). */
  plan: RouteStop | null;
  location: LatLng;
  /** The store name for a pickup, the site contact for a drop-off. */
  title: string;
  address: string;
  /** Expected arrival, epoch ms. */
  etaAt: number | null;
  /** 1-based position in the day's route. */
  sequence: number;
}

/** One job with its stops, in the order of its first stop. */
export interface PlannedJob {
  delivery: Delivery;
  pickup: PlannedStop | null;
  dropoff: PlannedStop;
}

/** True while the load is still at the store, so the pickup stop is still ahead. */
export function needsPickup(delivery: Delivery): boolean {
  return (
    delivery.pickup !== null &&
    delivery.pickup.collectedAt === null &&
    (delivery.status === 'assigned' || delivery.status === 'accepted')
  );
}

type StopBase = Omit<PlannedStop, 'plan' | 'etaAt' | 'sequence'>;

function stopsFor(delivery: Delivery): StopBase[] {
  const dropoff: StopBase = {
    key: `${delivery.id}:dropoff`,
    kind: 'dropoff',
    delivery,
    location: delivery.location,
    title: delivery.customer.name,
    address: delivery.address,
  };
  const pickup = delivery.pickup;
  if (!pickup || !needsPickup(delivery)) return [dropoff];
  return [
    {
      key: `${delivery.id}:pickup`,
      kind: 'pickup',
      delivery,
      location: pickup.location,
      title: pickup.storeName,
      address: pickup.address,
    },
    dropoff,
  ];
}

/**
 * Orders stops by the route plan (MARKETPLACE §5.11: a job's pickup always comes before its drop-off).
 * Stops the planner has not seen yet are appended, oldest job first, until the next plan arrives.
 */
export function orderStops(deliveries: readonly Delivery[], plan: RoutePlan | null): PlannedStop[] {
  const computedAt = toMillis(plan?.computedAt ?? null);
  const positions = new Map<string, { stop: RouteStop; index: number }>();
  (plan?.stops ?? []).forEach((stop, index) =>
    positions.set(`${stop.deliveryId}:${stop.kind}`, { stop, index }),
  );
  const created = (delivery: Delivery) => toMillis(delivery.createdAt) ?? 0;
  return deliveries
    .flatMap((delivery) =>
      stopsFor(delivery).map((stop, within) => {
        const planned = positions.get(stop.key);
        return {
          ...stop,
          plan: planned?.stop ?? null,
          etaAt: planned && computedAt ? computedAt + planned.stop.arrivalOffsetSeconds * 1000 : null,
          order: planned?.index ?? Number.MAX_SAFE_INTEGER,
          within,
        };
      }),
    )
    .sort((a, b) => a.order - b.order || created(a.delivery) - created(b.delivery) || a.within - b.within)
    .map(({ order: _order, within: _within, ...stop }, index) => ({ ...stop, sequence: index + 1 }));
}

/** Groups ordered stops back into jobs (for the two-stop cards of Today). */
export function jobsOf(stops: readonly PlannedStop[]): PlannedJob[] {
  const jobs = new Map<string, PlannedJob>();
  for (const stop of stops) {
    const job = jobs.get(stop.delivery.id);
    if (!job) {
      jobs.set(stop.delivery.id, {
        delivery: stop.delivery,
        pickup: stop.kind === 'pickup' ? stop : null,
        dropoff: stop,
      });
    } else if (stop.kind === 'dropoff') {
      job.dropoff = stop;
    }
  }
  return [...jobs.values()];
}

/** The driver's day: active deliveries in route order, as stops and as jobs. */
export function useOrderedStops(uid: string) {
  const deliveries = useActiveDeliveries(uid);
  const route = useRoutePlan(uid);
  const stops = useMemo(() => orderStops(deliveries.data, route.data), [deliveries.data, route.data]);
  const jobs = useMemo(() => jobsOf(stops), [stops]);
  return {
    stops,
    jobs,
    route: route.data,
    loading: deliveries.loading || route.loading,
    error: deliveries.error,
    retry: deliveries.retry,
  };
}

/** The stop to work on next: one already under way (at the store, driving to the site), else the first accepted. */
export function nextStopOf(stops: readonly PlannedStop[]): PlannedStop | null {
  const started = stops.find(
    (stop) =>
      stop.delivery.status === 'arrived' ||
      stop.delivery.status === 'in_transit' ||
      (stop.kind === 'pickup' && stop.delivery.pickup?.arrivedAt != null),
  );
  return started ?? stops.find((stop) => stop.delivery.status !== 'assigned') ?? null;
}
