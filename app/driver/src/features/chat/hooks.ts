import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type ChatThread } from '@instasupply/shared';
import type { WithId } from '@instasupply/api-client';
import { useApi, useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { queries } from '@/lib/api';

import { createMarkReadGate } from './mark-read-gate';

/** The dispatch thread (its id is the driver's uid); null until the first message. */
export function useThread(uid: string) {
  return useLiveQuery(queries.chatThread(uid));
}

/** The last 100 messages, oldest first; a new message is appended by its live event. */
export function useMessages(uid: string) {
  return useLiveQuery(queries.chatMessages(uid));
}

export interface SendInput {
  text: string;
  kind?: ChatMessage['kind'];
  deliveryId?: string | null;
}

/**
 * Sends a message with a client id (docs/CLIENTS.md §1.12): it is appended at once and stays until the
 * refetched list holds the confirmed copy (same id). Each `send` is its own request, so two quick taps
 * on quick replies send two messages (a `useApiMutation` would return the first promise for the second
 * call). A failure removes the message again and rejects with ApiError.
 */
export function useSendMessage(uid: string, senderName: string) {
  const client = useApi();
  const [sending, setSending] = useState(0);
  const send = useCallback(
    async (input: SendInput) => {
      const text = cleanMessage(input.text);
      if (!text) return;
      const id = client.newRequestId();
      const kind = input.kind ?? 'text';
      const deliveryId = input.deliveryId ?? null;
      const key = queries.chatMessages(uid).key;
      const rollback = client.cache.patch<ChatMessage[]>(key, (list) =>
        list.some((message) => message.id === id)
          ? list
          : [
              ...list,
              {
                id,
                text,
                kind,
                deliveryId,
                senderId: uid,
                senderName,
                senderRole: 'driver',
                createdAt: Date.now(),
              },
            ],
      );
      setSending((count) => count + 1);
      try {
        await client.chat.send(uid, { id, text, kind, deliveryId });
        await client.cache.invalidate(key);
      } finally {
        rollback();
        setSending((count) => count - 1);
      }
    },
    [client, uid, senderName],
  );
  return { send, sending: sending > 0 };
}

/** Trims to the length the server accepts; empty means "nothing to send". */
export function cleanMessage(text: string): string {
  return text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

/**
 * Marks the thread read only while the Dispatch tab is on screen and the app is in the foreground
 * (code review R58, R65): tabs stay mounted after the first visit, so an unconditional effect would
 * clear the unread badge while the driver is on another tab or the app is in the background.
 */
export function useMarkThreadReadWhenVisible(uid: string, thread: WithId<ChatThread> | null) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  const markRead = useApiMutation((client) => client.chat.markRead(uid), {
    optimistic: (cache) =>
      cache.patch<WithId<ChatThread> | null>(queries.chatThread(uid).key, (current) =>
        current ? { ...current, unreadByDriver: 0 } : current,
      ),
  });
  const unread = thread?.unreadByDriver ?? 0;
  const updatedAt = thread?.updatedAt ?? null;
  const run = markRead.run;
  // One try per server state of the thread: a failure rolls the patch back to the same unread count,
  // which must not fire the request again in a loop (offline, server error).
  const [gate] = useState(createMarkReadGate);
  const visible = focused && active;
  useEffect(() => {
    if (gate.shouldMark({ visible, unread, updatedAt })) void run().catch(() => undefined);
  }, [gate, visible, unread, updatedAt, run]);
}
