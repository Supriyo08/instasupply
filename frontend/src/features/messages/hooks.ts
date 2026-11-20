import { useLiveQuery } from '@instasupply/api-client/react';
import { MAX_CHAT_MESSAGE_LENGTH } from '@instasupply/shared';

import { api, queries } from '@/lib/api';

/** A driver's chat thread with dispatch (the thread id is the driver's uid). */
export function useThread(driverId: string | undefined) {
  return useLiveQuery(queries.chatThread(driverId));
}

/** The thread's latest 100 messages, oldest first; a new message is appended from the live event. */
export function useMessages(driverId: string | undefined) {
  return useLiveQuery(queries.chatMessages(driverId));
}

/** A message id, made once per message the dispatcher writes and reused if sending it is retried. */
export const newMessageId = () => api.newRequestId();

/**
 * Sends a staff message. The client-generated id makes a retry after a lost answer safe (D17): the
 * server stores the message once, so the caller passes the same `id` again on retry. The server stamps
 * the sender from the session.
 */
export async function sendStaffMessage(input: {
  id: string;
  driverId: string;
  text: string;
  deliveryId?: string | null;
}) {
  const text = input.text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
  if (!text) return;
  await api.chat.send(input.driverId, {
    id: input.id,
    text,
    deliveryId: input.deliveryId ?? null,
    kind: 'text',
  });
}

export async function markThreadRead(driverId: string) {
  await api.chat.markRead(driverId);
}
