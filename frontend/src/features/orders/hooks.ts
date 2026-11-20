/**
 * Marketplace order data for the ops Orders screens (MARKETPLACE §9, CLIENTS §4.5): parent orders,
 * the store orders inside them, and the staff-only private meta. Lists are paged and live; the server
 * applies every filter (status, storeId, customerId, needsAttention, acceptOverdue, …).
 */
import type { QueryValue } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';

import { queries } from '@/lib/api';

export type OrderFilters = Record<string, QueryValue>;

/** Parent orders, newest first (`GET /orders`). */
export function useOpsOrders(filters: OrderFilters = {}) {
  return usePagedQuery(queries.opsOrders(filters));
}

/** Store orders across stores, newest first (`GET /store-orders`). */
export function useOpsStoreOrders(filters: OrderFilters = {}) {
  return usePagedQuery(queries.opsStoreOrders(filters));
}

export function useOrder(orderId: string | null | undefined) {
  return useLiveQuery(queries.order(orderId));
}

/** The store orders of one parent order. */
export function useOrderStoreOrders(orderId: string | null | undefined) {
  return useLiveQuery(queries.orderStoreOrders(orderId));
}

export function useStoreOrder(storeOrderId: string | null | undefined) {
  return useLiveQuery(queries.storeOrder(storeOrderId));
}

/** Pickup PIN state and payment references of a store order (staff only). */
export function useStoreOrderPrivate(storeOrderId: string | null | undefined) {
  return useLiveQuery(queries.storeOrderPrivate(storeOrderId));
}
