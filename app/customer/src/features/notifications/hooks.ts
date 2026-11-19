import { useLiveQuery } from '@instasupply/expo-firebase';
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

export function useNotifications(uid: string) {
  const inbox = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.notifications),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
    [uid],
  );
  const result = useLiveQuery<AppNotification>(inbox, `inbox:${uid}`);
  return { ...result, unread: result.data.filter((item) => !item.read).length };
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

/** Where tapping a notification should go. */
export function notificationHref(data: Record<string, unknown> | undefined): string {
  if (data && typeof data.customerOrderId === 'string') return `/orders/${data.customerOrderId}`;
  return '/notifications';
}
