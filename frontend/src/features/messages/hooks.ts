import { COLLECTIONS, MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type ChatThread } from '@instasupply/shared';
import {
  addDoc,
  collection,
  doc,
  limitToLast,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase/app';
import { useCollection, useDocument } from '@/lib/firebase/hooks';

export function useThread(driverId: string | undefined) {
  const ref = useMemo(() => (driverId ? doc(db, COLLECTIONS.threads, driverId) : null), [driverId]);
  return useDocument<ChatThread>(ref);
}

export function useMessages(driverId: string | undefined) {
  const q = useMemo(
    () =>
      driverId
        ? query(
            collection(db, COLLECTIONS.threads, driverId, COLLECTIONS.messages),
            orderBy('createdAt', 'asc'),
            limitToLast(200),
          )
        : null,
    [driverId],
  );
  return useCollection<ChatMessage>(q);
}

/** Message fields must match the security rules exactly. */
export async function sendStaffMessage(input: {
  driverId: string;
  text: string;
  senderId: string;
  senderName: string;
  deliveryId?: string | null;
}) {
  const text = input.text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
  if (!text) return;
  await addDoc(collection(db, COLLECTIONS.threads, input.driverId, COLLECTIONS.messages), {
    text,
    senderId: input.senderId,
    senderName: input.senderName.slice(0, 80),
    senderRole: 'staff',
    deliveryId: input.deliveryId ?? null,
    kind: 'text',
    createdAt: serverTimestamp(),
  });
}

export async function markThreadRead(driverId: string) {
  await updateDoc(doc(db, COLLECTIONS.threads, driverId), {
    unreadByStaff: 0,
    staffReadAt: serverTimestamp(),
  });
}
