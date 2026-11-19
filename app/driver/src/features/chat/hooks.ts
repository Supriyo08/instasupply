import { COLLECTIONS, MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type ChatThread } from '@instasupply/shared';
import {
  addDoc,
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase';
import { useLiveDoc, useLiveQuery } from '@/lib/firestore-hooks';

export function useThread(uid: string) {
  const ref = useMemo(() => doc(db, COLLECTIONS.threads, uid), [uid]);
  return useLiveDoc<ChatThread>(ref, `thread:${uid}`);
}

export function useMessages(uid: string) {
  const messagesQuery = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.threads, uid, COLLECTIONS.messages),
        orderBy('createdAt', 'desc'),
        limit(100),
      ),
    [uid],
  );
  return useLiveQuery<ChatMessage>(messagesQuery, `messages:${uid}`);
}

export async function sendMessage(input: {
  uid: string;
  senderName: string;
  text: string;
  kind?: ChatMessage['kind'];
  deliveryId?: string | null;
}) {
  const text = input.text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
  if (!text) return;
  await addDoc(collection(db, COLLECTIONS.threads, input.uid, COLLECTIONS.messages), {
    text,
    senderId: input.uid,
    senderName: input.senderName.slice(0, 80) || 'Driver',
    senderRole: 'driver',
    deliveryId: input.deliveryId ?? null,
    kind: input.kind ?? 'text',
    createdAt: serverTimestamp(),
  });
}

export async function markThreadRead(uid: string) {
  await updateDoc(doc(db, COLLECTIONS.threads, uid), { unreadByDriver: 0, driverReadAt: serverTimestamp() });
}
