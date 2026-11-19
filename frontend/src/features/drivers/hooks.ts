import { COLLECTIONS, type Delivery, type DriverLocation, type UserProfile } from '@instasupply/shared';
import { collection, doc, getCountFromServer, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { db } from '@/lib/firebase/app';
import { useCollection, useDocument } from '@/lib/firebase/hooks';

export function useDriver(driverId: string | undefined) {
  const ref = useMemo(() => (driverId ? doc(db, COLLECTIONS.users, driverId) : null), [driverId]);
  return useDocument<UserProfile>(ref);
}

export function useDriverLocation(driverId: string | undefined) {
  const ref = useMemo(() => (driverId ? doc(db, COLLECTIONS.driverLocations, driverId) : null), [driverId]);
  return useDocument<DriverLocation>(ref);
}

export function useDriverDeliveries(driverId: string | undefined, count = 50) {
  const q = useMemo(
    () =>
      driverId
        ? query(
            collection(db, COLLECTIONS.deliveries),
            where('driverId', '==', driverId),
            orderBy('createdAt', 'desc'),
            limit(count),
          )
        : null,
    [count, driverId],
  );
  return useCollection<Delivery>(q);
}

/** All-time totals via aggregation queries (cheap: one read per 1000 matching docs). */
export function useDriverTotals(driverId: string | undefined) {
  const [totals, setTotals] = useState<{ delivered: number; failed: number } | null>(null);

  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    const countWith = (status: 'delivered' | 'failed') =>
      getCountFromServer(
        query(
          collection(db, COLLECTIONS.deliveries),
          where('driverId', '==', driverId),
          where('status', '==', status),
        ),
      ).then((snapshot) => snapshot.data().count);
    Promise.all([countWith('delivered'), countWith('failed')])
      .then(([delivered, failed]) => !cancelled && setTotals({ delivered, failed }))
      .catch(() => !cancelled && setTotals(null));
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  return totals;
}
