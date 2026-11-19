import { COLLECTIONS } from '@instasupply/shared';
import { useFocusEffect } from 'expo-router';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { useCallback, useState } from 'react';

import { db } from '@/lib/firebase';

/**
 * Lifetime order count for the account tab. A server-side count query (one read) refreshed each
 * time the tab gains focus, instead of a live listener on the whole order history.
 * Returns null while loading and NaN when the count could not be loaded.
 */
export function useOrderCount(uid: string): number | null {
  const [count, setCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCountFromServer(query(collection(db, COLLECTIONS.orders), where('customerId', '==', uid)))
        .then((snapshot) => {
          if (active) setCount(snapshot.data().count);
        })
        .catch(() => {
          if (active) setCount((current) => current ?? Number.NaN);
        });
      return () => {
        active = false;
      };
    }, [uid]),
  );

  return count;
}
