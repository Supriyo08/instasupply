import type { ChatMessage } from '@instasupply/shared';

import type { ChatMessageInput } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

/** Dispatch ↔ driver threads (PLATFORM §5.3.6); a thread's id is the driver's uid. */
export const chatPaths = {
  threads: '/threads',
  thread: (driverId: string) => `/threads/${seg(driverId)}`,
  messages: (driverId: string) => `/threads/${seg(driverId)}/messages`,
  read: (driverId: string) => `/threads/${seg(driverId)}/read`,
} as const;

export function createChat(ctx: ResourceContext) {
  return {
    /** The same `id` twice is one message, so a retry after a lost answer is safe. */
    send: (driverId: string, message: ChatMessageInput) =>
      writeThen(ctx, [['chat-thread', driverId], ['chat-threads']], () =>
        ctx.rest.post<ChatMessage>(chatPaths.messages(driverId), message),
      ),
    /** Resets the caller's side only. */
    markRead: (driverId: string) =>
      writeThen(ctx, [['chat-thread', driverId], ['chat-threads'], ['ops-dashboard']], () =>
        ctx.rest.post(chatPaths.read(driverId)),
      ),
  };
}
