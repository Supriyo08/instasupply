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
import { useMemo } from 'react';

import { db } from '@/lib/firebase';
import { useLiveQuery } from '@/lib/firestore-hooks';

export function useNotifications(uid: string) {
  const inboxQuery = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.notifications),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
    [uid],
  );
  const result = useLiveQuery<AppNotification>(inboxQuery, `inbox:${uid}`);
  const unread = useMemo(() => result.data.filter((item) => !item.read).length, [result.data]);
  return { ...result, unread };
}

export async function markRead(id: string) {
  await updateDoc(doc(db, COLLECTIONS.notifications, id), { read: true, readAt: serverTimestamp() });
}

export async function markAllRead(items: AppNotification[]) {
  const unread = items.filter((item) => !item.read);
  if (unread.length === 0) return;
  const batch = writeBatch(db);
  unread.forEach((item) =>
    batch.update(doc(db, COLLECTIONS.notifications, item.id), { read: true, readAt: serverTimestamp() }),
  );
  await batch.commit();
}

/** Where tapping a notification should take the driver. */
export function notificationHref(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  if (typeof data.threadId === 'string') return '/chat';
  if (
    typeof data.deliveryId === 'string' &&
    data.type !== 'delivery_unassigned' &&
    data.type !== 'delivery_cancelled'
  ) {
    return `/delivery/${data.deliveryId}`;
  }
  return '/notifications';
}
