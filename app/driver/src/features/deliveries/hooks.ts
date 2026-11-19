import {
  ACTIVE_STATUSES,
  COLLECTIONS,
  TERMINAL_STATUSES,
  startOfDay,
  toMillis,
  type Delivery,
  type DeliveryEvent,
  type RoutePlan,
  type RouteStop,
} from '@instasupply/shared';
import {
  Timestamp,
  collection,
  doc,
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { db } from '@/lib/firebase';
import { useLiveDoc, useLiveQuery } from '@/lib/firestore-hooks';

export function useActiveDeliveries(uid: string) {
  const activeQuery = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.deliveries),
        where('driverId', '==', uid),
        where('status', 'in', ACTIVE_STATUSES),
      ),
    [uid],
  );
  return useLiveQuery<Delivery>(activeQuery, `active:${uid}`);
}

export function useRoutePlan(uid: string) {
  const ref = useMemo(() => doc(db, COLLECTIONS.routes, uid), [uid]);
  return useLiveDoc<RoutePlan>(ref, `route:${uid}`);
}

export function useDelivery(id: string | undefined) {
  const ref = useMemo(() => (id ? doc(db, COLLECTIONS.deliveries, id) : null), [id]);
  return useLiveDoc<Delivery>(ref, `delivery:${id}`);
}

export function useDeliveryEvents(id: string | undefined) {
  const eventsQuery = useMemo(
    () =>
      id
        ? query(
            collection(db, COLLECTIONS.deliveries, id, COLLECTIONS.events),
            orderBy('at', 'desc'),
            limit(30),
          )
        : null,
    [id],
  );
  return useLiveQuery<DeliveryEvent>(eventsQuery, `events:${id}`);
}

export function useDeliveryHistory(uid: string) {
  const historyQuery = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.deliveries),
        where('driverId', '==', uid),
        where('status', 'in', TERMINAL_STATUSES),
        orderBy('updatedAt', 'desc'),
        limit(50),
      ),
    [uid],
  );
  return useLiveQuery<Delivery>(historyQuery, `history:${uid}`);
}

export interface PlannedStop {
  delivery: Delivery;
  plan: RouteStop | null;
  /** Expected arrival, epoch ms. */
  etaAt: number | null;
  /** 1-based position in the optimized route. */
  sequence: number;
}

/**
 * Active deliveries in optimized route order. Deliveries the planner hasn't seen yet (e.g. just
 * assigned) are appended until the next plan arrives.
 */
export function useOrderedStops(uid: string) {
  const deliveries = useActiveDeliveries(uid);
  const route = useRoutePlan(uid);

  const stops = useMemo<PlannedStop[]>(() => {
    const plan = route.data;
    const computedAt = toMillis(plan?.computedAt);
    const positions = new Map(plan?.stops.map((stop, index) => [stop.deliveryId, { stop, index }]) ?? []);
    return deliveries.data
      .map((delivery) => {
        const planned = positions.get(delivery.id);
        return {
          delivery,
          plan: planned?.stop ?? null,
          etaAt: planned && computedAt ? computedAt + planned.stop.arrivalOffsetSeconds * 1000 : null,
          order: planned?.index ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort(
        (a, b) =>
          a.order - b.order || (toMillis(a.delivery.createdAt) ?? 0) - (toMillis(b.delivery.createdAt) ?? 0),
      )
      .map(({ order: _order, ...rest }, index) => ({ ...rest, sequence: index + 1 }));
  }, [deliveries.data, route.data]);

  return { stops, route: route.data, loading: deliveries.loading || route.loading, error: deliveries.error };
}

/** Number of deliveries completed today (server-side count, refreshed when work changes). */
export function useDeliveredToday(uid: string, refreshKey: unknown) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const todayQuery = query(
      collection(db, COLLECTIONS.deliveries),
      where('driverId', '==', uid),
      where('status', '==', 'delivered'),
      where('deliveredAt', '>=', Timestamp.fromMillis(startOfDay())),
    );
    getCountFromServer(todayQuery)
      .then((snapshot) => !cancelled && setCount(snapshot.data().count))
      .catch(() => !cancelled && setCount(null));
    return () => {
      cancelled = true;
    };
  }, [uid, refreshKey]);
  return count;
}
