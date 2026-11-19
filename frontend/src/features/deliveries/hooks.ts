import {
  COLLECTIONS,
  PRIVATE_META_DOC,
  type Delivery,
  type DeliveryEvent,
  type DeliveryPrivateMeta,
} from '@instasupply/shared';
import { collection, doc, orderBy, query } from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase/app';
import { useCollection, useDocument } from '@/lib/firebase/hooks';

export function useDelivery(deliveryId: string | undefined) {
  const ref = useMemo(() => (deliveryId ? doc(db, COLLECTIONS.deliveries, deliveryId) : null), [deliveryId]);
  return useDocument<Delivery>(ref);
}

export function useDeliveryEvents(deliveryId: string | undefined) {
  const q = useMemo(
    () =>
      deliveryId
        ? query(collection(db, COLLECTIONS.deliveries, deliveryId, COLLECTIONS.events), orderBy('at', 'desc'))
        : null,
    [deliveryId],
  );
  return useCollection<DeliveryEvent>(q);
}

/** Tracking token + hand-off code (staff-only document). */
export function usePrivateMeta(deliveryId: string | undefined) {
  const ref = useMemo(
    () =>
      deliveryId ? doc(db, COLLECTIONS.deliveries, deliveryId, COLLECTIONS.private, PRIVATE_META_DOC) : null,
    [deliveryId],
  );
  return useDocument<DeliveryPrivateMeta>(ref);
}

export const trackingUrl = (token: string) => `${window.location.origin}/track/${token}`;
