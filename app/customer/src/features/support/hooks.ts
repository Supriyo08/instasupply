import { queries } from '@instasupply/api-client';
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import type { SupportContext, SupportMessage } from '@instasupply/shared';

import { newRequestId } from '@/lib/ids';

/**
 * The customer's support chat. Their thread id is their uid (MARKETPLACE §1.1); the first message
 * creates the thread, so `thread` is null until then.
 */
export function useSupportThread(uid: string | null | undefined) {
  const thread = useLiveQuery(queries.supportThread(uid));
  const messages = useLiveQuery(queries.supportMessages(uid));
  return { thread, messages };
}

/** Just the thread summary (unread count for the Account menu), without loading the messages. */
export function useSupportSummary(uid: string | null | undefined) {
  return useLiveQuery(queries.supportThread(uid));
}

/**
 * Sends a message, appended at once under the same id the server will use, and marks the thread
 * read. `send.run({ text, context })`; keep the typed text on failure (the patch rolls back).
 */
export function useSupportActions(uid: string | null | undefined) {
  const messagesKey = queries.supportMessages(uid).key;
  const send = useApiMutation<{ text: string; context: SupportContext | null; id?: string }, unknown>(
    (api, variables) => {
      if (!uid) return Promise.reject(new Error('Sign in to chat with support.'));
      return api.support.send(uid, {
        id: variables.id ?? newRequestId(),
        text: variables.text,
        context: variables.context,
      });
    },
    {
      optimistic: (cache, variables) => {
        // The id is fixed here so the server's copy replaces this one instead of doubling it.
        variables.id ??= newRequestId();
        const pending: SupportMessage = {
          id: variables.id,
          text: variables.text,
          context: variables.context,
          senderId: uid ?? '',
          senderName: 'You',
          senderRole: 'customer',
          createdAt: Date.now(),
        };
        cache.patch<SupportMessage[]>(messagesKey, (items) => [...items, pending]);
      },
    },
  );
  const markRead = useApiMutation<void, unknown>((api) =>
    uid ? api.support.markRead(uid) : Promise.resolve(undefined),
  );
  return { send, markRead };
}
