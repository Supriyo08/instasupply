import { COLLECTIONS, type AppNotification } from '@instasupply/shared';
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useCallback, useMemo } from 'react';

import { db } from '@/lib/firebase/app';
import { useCollection } from '@/lib/firebase/hooks';

export function useNotifications(uid: string | null | undefined, count = 30) {
  const q = useMemo(
    () =>
      uid
        ? query(
            collection(db, COLLECTIONS.notifications),
            where('userId', '==', uid),
            orderBy('createdAt', 'desc'),
            limit(count),
          )
        : null,
    [count, uid],
  );
  const state = useCollection<AppNotification>(q);
  const unread = state.data.filter((item) => !item.read);

  const markRead = useCallback(async (id: string) => {
    await updateDoc(doc(db, COLLECTIONS.notifications, id), { read: true, readAt: serverTimestamp() });
  }, []);

  const markAllRead = useCallback(async () => {
    const batch = writeBatch(db);
    unread.forEach((item) =>
      batch.update(doc(db, COLLECTIONS.notifications, item.id), { read: true, readAt: serverTimestamp() }),
    );
    await batch.commit();
  }, [unread]);

  return { ...state, unreadCount: unread.length, markRead, markAllRead };
}

/** Where a notification should take the user when clicked. */
export function notificationLink(notification: Pick<AppNotification, 'data'>): string | null {
  const { threadId, deliveryId, driverId, customerOrderId } = notification.data ?? {};
  if (threadId) return `/messages/${threadId}`;
  if (customerOrderId) return `/orders/${customerOrderId}`;
  if (deliveryId) return `/deliveries/${deliveryId}`;
  if (driverId) return `/drivers/${driverId}`;
  return null;
}
