import type { SupportMessage, SupportThread } from '@instasupply/shared';

import type { SupportMessageInput, SupportThreadPatch, WithId } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

/** Support threads (PLATFORM §5.3.6): a customer's id is their uid, a store's is `store_{storeId}`. */
export const supportPaths = {
  threads: '/support-threads',
  thread: (threadId: string) => `/support-threads/${seg(threadId)}`,
  messages: (threadId: string) => `/support-threads/${seg(threadId)}/messages`,
  read: (threadId: string) => `/support-threads/${seg(threadId)}/read`,
} as const;

/** The support thread id of a store (MARKETPLACE §1.1). */
export function storeThreadId(storeId: string): string {
  return `store_${storeId}`;
}

export function createSupport(ctx: ResourceContext) {
  return {
    /** Creates the thread on its first message; the same `id` twice is one message. */
    send: (threadId: string, message: SupportMessageInput) =>
      writeThen(ctx, [['support-thread', threadId], ['support-threads']], () =>
        ctx.rest.post<SupportMessage>(supportPaths.messages(threadId), message),
      ),
    markRead: (threadId: string) =>
      writeThen(ctx, [['support-thread', threadId], ['support-threads'], ['ops-dashboard']], () =>
        ctx.rest.post(supportPaths.read(threadId)),
      ),
    /** Staff only. */
    update: (threadId: string, patch: SupportThreadPatch) =>
      writeThen(ctx, [['support-thread', threadId], ['support-threads']], () =>
        ctx.rest.patch<WithId<SupportThread>>(supportPaths.thread(threadId), patch),
      ),
  };
}
