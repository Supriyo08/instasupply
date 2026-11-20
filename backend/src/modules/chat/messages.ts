/**
 * `postChatMessage(tx, …)` (docs/PLATFORM.md §9.4, was `onChatMessageCreated`, ported from
 * legacy/…/chat/on-message-created.ts): thread created on the first message and locked (rank 12), the message
 * inserted once (`ON CONFLICT (id) DO NOTHING`; a repeated client id answers the stored message), the summary
 * and the other side's unread counter, and the notification: driver → staff, staff → the driver
 * (`chat_message`, key `chat-{messageId}`, data `threadId` and `deliveryId`).
 */
import type { ChatMessage, ChatSenderRole } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { ApiError, notFound } from '../../platform/http/errors';
import { notify, notifyStaff } from '../notifications/notify';
import {
  applyMessageToChatThread,
  driverName,
  ensureChatThread,
  findChatMessage,
  insertChatMessage,
  lockChatThread,
} from './repository';

export interface PostChatMessageInput {
  driverId: string;
  id: string;
  text: string;
  deliveryId: string | null;
  kind: 'text' | 'quick_reply';
  sender: { uid: string; name: string; role: ChatSenderRole };
}

const LAST_MESSAGE_CHARS = 140;
const PUSH_BODY_CHARS = 200;

export async function postChatMessage(
  tx: Tx,
  input: PostChatMessageInput,
): Promise<{ message: ChatMessage; created: boolean }> {
  const existing = await findChatMessage(tx, input.id);
  if (existing) return same(existing.threadId, existing.message, input);

  const name = await driverName(tx, input.driverId);
  if (name === null) notFound('That driver does not exist.');
  await ensureChatThread(tx, input.driverId, name);
  if (!(await lockChatThread(tx, input.driverId))) notFound('That driver does not exist.');

  const message: ChatMessage = {
    id: input.id,
    text: input.text,
    senderId: input.sender.uid,
    senderName: input.sender.name.trim().slice(0, 80) || (input.sender.role === 'staff' ? 'Dispatch' : name),
    senderRole: input.sender.role,
    deliveryId: input.deliveryId,
    kind: input.kind,
    createdAt: tx.now,
  };
  if (!(await insertChatMessage(tx, input.driverId, message))) {
    const stored = await findChatMessage(tx, input.id);
    if (!stored) throw new ApiError('internal', 'The message could not be stored.');
    return same(stored.threadId, stored.message, input);
  }

  const fromDriver = input.sender.role === 'driver';
  await applyMessageToChatThread(tx, input.driverId, {
    driverName: name,
    lastMessage: {
      text: input.text.slice(0, LAST_MESSAGE_CHARS),
      senderId: input.sender.uid,
      senderRole: input.sender.role,
      at: tx.now,
    },
    fromDriver,
  });

  const notification = {
    type: 'chat_message' as const,
    body: input.text.slice(0, PUSH_BODY_CHARS),
    data: { threadId: input.driverId, ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}) },
    key: `chat-${input.id}`,
  };
  if (fromDriver) await notifyStaff(tx, { ...notification, title: name });
  else await notify(tx, input.driverId, { ...notification, title: `Dispatch · ${message.senderName}` });
  return { message, created: true };
}

function same(
  threadId: string,
  message: ChatMessage,
  input: PostChatMessageInput,
): { message: ChatMessage; created: boolean } {
  if (threadId !== input.driverId || message.senderId !== input.sender.uid) {
    throw new ApiError('already-exists', 'That message id is already used. Create a new one.');
  }
  return { message, created: false };
}
