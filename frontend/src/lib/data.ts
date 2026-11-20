/**
 * Shared live data used by several screens (layout badges, dashboard, live map, deliveries, drivers).
 * Each hook is one line over a query descriptor of `@instasupply/api-client` (docs/CLIENTS.md §4.1,
 * §4.5). The query cache de-duplicates identical keys, so calling these hooks in many places costs
 * one request and one topic subscription.
 */
import type { QueryResult, QueryValue, WithId } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery, type PagedResult } from '@instasupply/api-client/react';
import {
  LOCATION_STALE_MS,
  localDateOf,
  startOfLocalDay,
  toMillis,
  type ChatThread,
  type Delivery,
  type DeliveryEvent,
  type DriverLocation,
  type OpsDashboard,
  type RoutePlan,
  type StoreOrder,
  type UserProfile,
} from '@instasupply/shared';
import { useEffect, useMemo, useState } from 'react';

import { queries } from './api';

export type { WithId } from '@instasupply/api-client';
export type { PagedResult } from '@instasupply/api-client/react';

/** A list query's state: `{ data, loading, error, retry, refreshing, updatedAt }`. */
export type CollectionState<T> = QueryResult<WithId<T>[]>;
/** A document query's state. `data` is null while loading, when disabled and when the row does not exist. */
export type DocumentState<T> = QueryResult<WithId<T> | null>;

/** A user row with `id` = `uid`, so user lists work with `indexById`, `mergeById` and `key={row.id}`. */
export type UserRecord = WithId<UserProfile>;
export type DriverRecord = UserRecord;
export type DeliveryRecord = WithId<Delivery>;
export type LocationRecord = WithId<DriverLocation>;
export type StoreOrderRecord = WithId<StoreOrder>;

/** Re-renders every `intervalMs` so relative times, countdowns and staleness stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Start of today in Toronto (MARKETPLACE §4.1), epoch ms. Changes at Toronto midnight, whatever the PC's zone. */
export function useStartOfToday(): number {
  const now = useNow(60_000);
  return startOfLocalDay(localDateOf(now));
}

/** The API answers user rows keyed by `uid`; this adds `id`, memoized so references stay stable. */
function useUserList(result: QueryResult<UserProfile[]>): QueryResult<UserRecord[]> {
  const { data } = result;
  const rows = useMemo(() => data.map((user) => ({ ...user, id: user.uid })), [data]);
  return { ...result, data: rows };
}

export function useDrivers(): QueryResult<UserRecord[]> {
  return useUserList(useLiveQuery(queries.drivers()));
}

export function useStaff(): QueryResult<UserRecord[]> {
  return useUserList(useLiveQuery(queries.staff()));
}

export function useDriverLocations(): CollectionState<DriverLocation> {
  return useLiveQuery(queries.driverLocations());
}

/**
 * Every delivery that is not final (unassigned to arrived), newest first: one server list that follows
 * the cursor up to 2 000 rows (CLIENTS §1.11). Failed deliveries are not open; ops resolve them from
 * the failed store orders (`useFailedStoreOrders`), so they never drop out of view after a day (R54).
 */
export function useOpenDeliveries(): QueryResult<Delivery[]> {
  return useLiveQuery(queries.openDeliveries());
}

/** Deliveries that became delivered, failed or cancelled since `sinceMs` (default: start of today in Toronto). */
export function useClosedToday(sinceMs?: number): QueryResult<Delivery[]> {
  const today = useStartOfToday();
  return useLiveQuery(queries.deliveriesClosedSince(sinceMs ?? today));
}

/** Deliveries created since `sinceMs`. */
export function useRecentDeliveries(sinceMs: number): QueryResult<Delivery[]> {
  return useLiveQuery(queries.deliveriesCreatedSince(sinceMs));
}

/**
 * A driver's route plan, or null. A row whose `stops` or `polyline` is not an array counts as no route
 * (verified defect R40: a half-written plan crashed every screen that read `.length`).
 */
export function useRoute(driverId: string | null | undefined): QueryResult<RoutePlan | null> {
  const result = useLiveQuery(queries.route(driverId));
  const plan = result.data;
  if (plan && (!Array.isArray(plan.stops) || !Array.isArray(plan.polyline))) return { ...result, data: null };
  return result;
}

/** Driver chat threads, most recent first. */
export function useThreads(): CollectionState<ChatThread> {
  return useLiveQuery(queries.chatThreads());
}

/** Recent delivery events across the fleet (dashboard activity feed). */
export function useActivity(count = 25): QueryResult<DeliveryEvent[]> {
  return useLiveQuery(queries.activity(count));
}

/**
 * Store orders for ops (`GET /store-orders` with filters such as `{ status: ['new'] }`,
 * `{ acceptOverdue: true }`, `{ storeId }`), newest first, paged and live.
 */
export function useOpenStoreOrders(filters: Record<string, QueryValue> = {}): PagedResult<StoreOrder> {
  return usePagedQuery(queries.opsStoreOrders(filters));
}

/** Store orders whose delivery failed and that ops still have to resolve (MARKETPLACE §9, Needs attention). */
export function useFailedStoreOrders(): PagedResult<StoreOrder> {
  return useOpenStoreOrders({ status: ['failed'] });
}

/** The ops dashboard counters; also the sidebar badges (`GET /ops/dashboard`, one request). */
export function useOpsDashboard(): QueryResult<OpsDashboard | null> {
  return useLiveQuery(queries.opsDashboard());
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

/** Merge lists, preferring the first occurrence of each id. */
export function mergeById<T extends { id: string }>(...lists: readonly (readonly T[])[]): T[] {
  const seen = new Map<string, T>();
  for (const list of lists) for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
