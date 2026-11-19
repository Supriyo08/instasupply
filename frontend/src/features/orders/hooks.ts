/**
 * Realtime shop-order queries. Every multi-field query here is backed by an index in
 * firebase/firestore.indexes.json (status + createdAt desc); the rest are single-field.
 * Open orders come from `useOpenOrders` in lib/data (shared with the sidebar badge).
 */
import { COLLECTIONS, type Order, type OrderStatus } from '@instasupply/shared';
import { Timestamp, collection, doc, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase/app';
import { useCollection, useDocument } from '@/lib/firebase/hooks';

/** History lists (needs attention, delivered, cancelled, all) show this many of the newest orders. */
export const ORDER_LIST_LIMIT = 300;

/** Safety cap for today's KPIs, far above a normal day's volume. */
export const TODAY_LIMIT = 1000;

export function useOrder(orderId: string | null | undefined) {
  const ref = useMemo(() => (orderId ? doc(db, COLLECTIONS.orders, orderId) : null), [orderId]);
  return useDocument<Order>(ref);
}

/** Newest orders in one status. `null` loads nothing. */
export function useOrdersWithStatus(status: OrderStatus | null) {
  const q = useMemo(
    () =>
      status
        ? query(
            collection(db, COLLECTIONS.orders),
            where('status', '==', status),
            orderBy('createdAt', 'desc'),
            limit(ORDER_LIST_LIMIT),
          )
        : null,
    [status],
  );
  return useCollection<Order>(q);
}

/** Newest orders in any status. Loads nothing until `enabled`. */
export function useLatestOrders(enabled: boolean) {
  const q = useMemo(
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.orders), orderBy('createdAt', 'desc'), limit(ORDER_LIST_LIMIT))
        : null,
    [enabled],
  );
  return useCollection<Order>(q);
}

/** Every order placed since `sinceMillis` (e.g. local midnight), newest first. */
export function useOrdersSince(sinceMillis: number) {
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.orders),
        where('createdAt', '>=', Timestamp.fromMillis(sinceMillis)),
        orderBy('createdAt', 'desc'),
        limit(TODAY_LIMIT),
      ),
    [sinceMillis],
  );
  return useCollection<Order>(q);
}
