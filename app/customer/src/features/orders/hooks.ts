import { queries, type OrderState } from '@instasupply/api-client';
import { useApiQuery, useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import type { CancelOrderRequest, PlaceOrderRequest } from '@instasupply/shared';

import { useSession } from '@/features/session/SessionProvider';
import { call } from '@/lib/callables';

/** The customer's orders, newest first, paged and live (`user:{uid}:orders`). Orders tab and Home. */
export function useCustomerOrders(
  uid: string | null | undefined,
  state: OrderState,
  filters: { jobsiteId?: string | null } = {},
) {
  return usePagedQuery(queries.customerOrders(uid, state, filters));
}

/** One order, live; null when it does not exist or is not the caller's. */
export function useOrder(orderId: string | null | undefined) {
  return useLiveQuery(queries.order(orderId));
}

/** The store orders of an order, by letter (A, B, …), live with the order. */
export function useOrderStoreOrders(orderId: string | null | undefined) {
  return useLiveQuery(queries.orderStoreOrders(orderId));
}

/** One store order, live (review screen, issue form). */
export function useStoreOrder(storeOrderId: string | null | undefined) {
  return useLiveQuery(queries.storeOrder(storeOrderId));
}

/** The drop-off photo and recipient of a delivered store order; the photo URL refreshes itself. */
export function useStoreOrderProof(storeOrderId: string | null | undefined) {
  return useApiQuery(queries.storeOrderProof(storeOrderId));
}

/** Public tracking of one delivery: phase, driver position, ETA, hand-off code. Pushed live. */
export function useTracking(token: string | null | undefined) {
  return useLiveQuery(queries.tracking(token));
}

/**
 * True when the next order is a first order (`profile.stats.nonCancelledOrders === 0`); guests count
 * as first-time customers for the banners. The server decides at checkout.
 */
export function useIsFirstOrder(): boolean {
  const { profile } = useSession();
  return profile ? (profile.stats?.nonCancelledOrders ?? 0) === 0 : true;
}

/**
 * Pass a `checkoutId` from `newRequestId()` created once per checkout attempt and kept across
 * retries: a retry after a lost answer then returns the same order. Map errors with `errorCodeOf`
 * and `detailsFor` (MARKETPLACE §5.9; docs/CLIENTS.md §4.3 checkout row).
 */
export function placeOrder(request: PlaceOrderRequest) {
  return call('placeOrder', request);
}

/** Cancels the whole order, or only `storeOrderIds` while they are new or accepted. */
export function cancelOrder(request: CancelOrderRequest) {
  return call('cancelOrder', request);
}
