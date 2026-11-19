import { useLiveDoc, useLiveQuery } from '@instasupply/expo-firebase';
import {
  COLLECTIONS,
  type CancelOrderRequest,
  type Order,
  type PlaceOrderRequest,
  type PublicTracking,
} from '@instasupply/shared';
import { collection, doc, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';

import { call } from '@/lib/callables';
import { db } from '@/lib/firebase';

export function useOrders(uid: string | undefined, max = 50) {
  const ordersQuery = useMemo(
    () =>
      uid
        ? query(
            collection(db, COLLECTIONS.orders),
            where('customerId', '==', uid),
            orderBy('createdAt', 'desc'),
            limit(max),
          )
        : null,
    [uid, max],
  );
  return useLiveQuery<Order>(ordersQuery, `orders:${uid}:${max}`);
}

/** True until the shopper has a non-cancelled order (first-order promos). */
export function useIsFirstOrder(uid: string | undefined): boolean {
  const { data } = useOrders(uid, 20);
  return data.every((order) => order.status === 'cancelled');
}

export function useOrder(id: string | undefined) {
  const ref = useMemo(() => (id ? doc(db, COLLECTIONS.orders, id) : null), [id]);
  return useLiveDoc<Order>(ref, `order:${id}`);
}

/** Public tracking document: live driver position, ETA and the hand-off code. */
export function useTracking(token: string | null | undefined) {
  const ref = useMemo(() => (token ? doc(db, COLLECTIONS.tracking, token) : null), [token]);
  return useLiveDoc<PublicTracking & { id: string }>(ref, `tracking:${token}`);
}

export function placeOrder(request: PlaceOrderRequest) {
  return call('placeOrder', request);
}

export function cancelOrder(request: CancelOrderRequest) {
  return call('cancelOrder', request);
}
