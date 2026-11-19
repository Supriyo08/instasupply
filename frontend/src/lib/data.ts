/**
 * Shared realtime data used by several screens (dashboard, live map, deliveries, drivers).
 * Firestore deduplicates identical listeners, so calling these hooks in many places is cheap.
 */
import {
  COLLECTIONS,
  LOCATION_STALE_MS,
  OPEN_STATUSES,
  ORDER_OPEN_STATUSES,
  TERMINAL_STATUSES,
  startOfDay,
  toMillis,
  type ChatThread,
  type Delivery,
  type DeliveryEvent,
  type DriverLocation,
  type Order,
  type RoutePlan,
  type UserProfile,
} from '@instasupply/shared';
import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { db } from './firebase/app';
import { useCollection, useDocument, type WithId } from './firebase/hooks';

export type DriverRecord = WithId<UserProfile>;
export type DeliveryRecord = WithId<Delivery>;
export type LocationRecord = WithId<DriverLocation>;
export type OrderRecord = WithId<Order>;

/** Re-renders every `intervalMs` so relative times and staleness stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useDrivers() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.users), where('role', '==', 'driver')), []);
  return useCollection<UserProfile>(q);
}

export function useStaff() {
  const q = useMemo(
    () => query(collection(db, COLLECTIONS.users), where('role', 'in', ['admin', 'dispatcher'])),
    [],
  );
  return useCollection<UserProfile>(q);
}

export function useDriverLocations() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.driverLocations)), []);
  return useCollection<DriverLocation>(q);
}

/** Every delivery that still needs attention, newest first. */
export function useOpenDeliveries() {
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.deliveries),
        where('status', 'in', OPEN_STATUSES),
        orderBy('createdAt', 'desc'),
        limit(500),
      ),
    [],
  );
  return useCollection<Delivery>(q);
}

/** Shop orders that are not finished yet (placed → out for delivery), newest first. */
export function useOpenOrders() {
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.orders),
        where('status', 'in', ORDER_OPEN_STATUSES),
        orderBy('createdAt', 'desc'),
        limit(500),
      ),
    [],
  );
  return useCollection<Order>(q);
}

/** Deliveries that reached a terminal state since local midnight. */
export function useClosedToday() {
  const since = startOfDay();
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.deliveries),
        where('status', 'in', TERMINAL_STATUSES),
        where('updatedAt', '>=', Timestamp.fromMillis(since)),
        orderBy('updatedAt', 'desc'),
        limit(500),
      ),
    [since],
  );
  return useCollection<Delivery>(q);
}

/** All deliveries created since `sinceMillis`. */
export function useRecentDeliveries(sinceMillis: number) {
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.deliveries),
        where('createdAt', '>=', Timestamp.fromMillis(sinceMillis)),
        orderBy('createdAt', 'desc'),
        limit(500),
      ),
    [sinceMillis],
  );
  return useCollection<Delivery>(q);
}

export function useRoute(driverId: string | null | undefined) {
  const ref = useMemo(() => (driverId ? doc(db, COLLECTIONS.routes, driverId) : null), [driverId]);
  return useDocument<RoutePlan>(ref);
}

export function useThreads() {
  const q = useMemo(
    () => query(collection(db, COLLECTIONS.threads), orderBy('updatedAt', 'desc'), limit(200)),
    [],
  );
  return useCollection<ChatThread>(q);
}

export function useActivity(count = 25) {
  const q = useMemo(
    () => query(collectionGroup(db, COLLECTIONS.events), orderBy('at', 'desc'), limit(count)),
    [count],
  );
  return useCollection<DeliveryEvent>(q);
}

// ---------- derived helpers ----------

export type Presence = 'online' | 'stale' | 'offline';

export function presenceOf(location: DriverLocation | null | undefined, now: number): Presence {
  if (!location || !location.online) return 'offline';
  const at = toMillis(location.updatedAt);
  if (at == null || now - at > LOCATION_STALE_MS) return 'stale';
  return 'online';
}

export function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Active (driver-owned) deliveries grouped by driver id. */
export function groupActiveByDriver(deliveries: readonly DeliveryRecord[]): Map<string, DeliveryRecord[]> {
  const map = new Map<string, DeliveryRecord[]>();
  for (const delivery of deliveries) {
    if (!delivery.driverId || delivery.status === 'unassigned') continue;
    const list = map.get(delivery.driverId) ?? [];
    list.push(delivery);
    map.set(delivery.driverId, list);
  }
  return map;
}

/** Merge listener results, preferring the first occurrence of each id. */
export function mergeById<T extends { id: string }>(...lists: readonly (readonly T[])[]): T[] {
  const seen = new Map<string, T>();
  for (const list of lists) for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
