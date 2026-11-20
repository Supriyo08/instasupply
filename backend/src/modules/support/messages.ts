/**
 * `postSupportMessage(tx, …)` (docs/PLATFORM.md §9.4, was `onSupportMessageCreated`): one transaction does
 * what the trigger did. Called by `POST /support-threads/{threadId}/messages` and by `reopenQuote` (quotes),
 * through this module's barrel.
 *
 * 1. The thread is created on its first message (`INSERT … ON CONFLICT DO NOTHING`), then locked (rank 11).
 * 2. The message is inserted with `ON CONFLICT (id) DO NOTHING`: a repeated client id answers the stored
 *    message and changes nothing else. An id that belongs to another thread or sender is `already-exists`.
 * 3. Summary: `last_message` (140 characters), the other side's unread counter, `context`. A message from
 *    the owner reopens a resolved thread.
 * 4. Notifications, key `support-{messageId}`: from the owner → staff `support_message`; from staff → the
 *    customer, or every active member of the store, `support_reply`.
 */
import type { SupportContext, SupportMessage, SupportSenderRole } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { ApiError, notFound } from '../../platform/http/errors';
import { notify, notifyStaff, notifyStoreMembers, type NotificationInput } from '../notifications/notify';
import {
  applyMessageToThread,
  ensureThread,
  findMessage,
  insertMessage,
  lockThread,
  resolveOwner,
} from './repository';

export interface PostSupportMessageInput {
  /** The customer's uid or `store_{storeId}`. */
  threadId: string;
  /** The client's UUIDv4. */
  id: string;
  text: string;
  context: SupportContext | null;
  sender: { uid: string; name: string; role: SupportSenderRole };
}

export interface PostSupportMessageResult {
  message: SupportMessage;
  /** False when the id was already stored (a retry): nothing else was written. */
  created: boolean;
}

const LAST_MESSAGE_CHARS = 140;

const senderNameOf = (name: string, role: SupportSenderRole): string => {
  const trimmed = name.trim().slice(0, 80);
  if (trimmed) return trimmed;
  return role === 'staff' ? 'InstaSupply' : role === 'supplier' ? 'Store' : 'Customer';
};

export async function postSupportMessage(
  tx: Tx,
  input: PostSupportMessageInput,
): Promise<PostSupportMessageResult> {
  const existing = await findMessage(tx, input.id);
  if (existing) return sameMessage(existing.threadId, existing.message, input);

  const owner = await resolveOwner(tx, input.threadId);
  if (!owner) notFound('That support conversation does not exist.');
  await ensureThread(tx, { id: input.threadId, ...owner });
  const thread = await lockThread(tx, input.threadId);
  if (!thread) notFound('That support conversation does not exist.');

  const message: SupportMessage = {
    id: input.id,
    text: input.text,
    senderId: input.sender.uid,
    senderName: senderNameOf(input.sender.name, input.sender.role),
    senderRole: input.sender.role,
    context: input.context,
    createdAt: tx.now,
  };
  if (!(await insertMessage(tx, input.threadId, message))) {
    // Inserted concurrently by a retry of the same request: answer what is stored.
    const stored = await findMessage(tx, input.id);
    if (!stored) throw new ApiError('internal', 'The message could not be stored.');
    return sameMessage(stored.threadId, stored.message, input);
  }

  const inbound = input.sender.role !== 'staff';
  await applyMessageToThread(tx, input.threadId, {
    lastMessage: { text: input.text.slice(0, LAST_MESSAGE_CHARS), senderRole: input.sender.role, at: tx.now },
    inbound,
    context: input.context,
    reopen: inbound && thread.status === 'resolved',
  });

  const note: Omit<NotificationInput, 'type' | 'title'> = {
    body: input.text,
    data: { threadId: input.threadId },
    key: `support-${input.id}`,
  };
  if (inbound) {
    const who = owner.kind === 'store' ? `${owner.ownerName} (store)` : owner.ownerName;
    await notifyStaff(tx, { ...note, type: 'support_message', title: `Support · ${who}` });
  } else {
    const reply: NotificationInput = { ...note, type: 'support_reply', title: 'InstaSupply support' };
    if (owner.kind === 'store') await notifyStoreMembers(tx, owner.ownerId, reply);
    else await notify(tx, owner.ownerId, reply);
  }
  return { message, created: true };
}

/** A repeated id: the same request again answers the stored message; anything else is a conflict (D17). */
function sameMessage(
  threadId: string,
  message: SupportMessage,
  input: PostSupportMessageInput,
): PostSupportMessageResult {
  if (threadId !== input.threadId || message.senderId !== input.sender.uid) {
    throw new ApiError('already-exists', 'That message id is already used. Create a new one.');
  }
  return { message, created: false };
}
