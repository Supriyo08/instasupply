/**
 * Customer and store support chat (§1.3, D11): one thread per customer (`supportThreads/{uid}`) and
 * one per store (`supportThreads/store_{storeId}`, shared by its members). The dispatch ↔ driver chat
 * in `threads/{driverId}` is a separate pipeline and is not touched.
 */
import type { TimestampLike } from './types';

export type SupportThreadKind = 'customer' | 'store';

/** What a message is about; shown as a chip that links to it. */
export interface SupportContext {
  kind: 'order' | 'store_order' | 'quote' | 'issue';
  id: string;
  label: string;
}

/** The thread summary, kept by `onSupportMessageCreated`. */
export interface SupportThread {
  kind: SupportThreadKind;
  /** The customer's uid, or the store id. */
  ownerId: string;
  ownerName: string;
  companyName: string | null;
  status: 'open' | 'resolved';
  assignedTo: string | null;
  assignedName: string | null;
  context: SupportContext | null;
  lastMessage: { text: string; senderRole: SupportSenderRole; at: TimestampLike } | null;
  unreadByOwner: number;
  unreadByStaff: number;
  ownerReadAt: TimestampLike | null;
  staffReadAt: TimestampLike | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** The rules check it against the sender's claims, so a role cannot be spoofed (§6.3). */
export type SupportSenderRole = 'customer' | 'supplier' | 'staff';

/** `supportThreads/{threadId}/messages/{messageId}`. */
export interface SupportMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderRole: SupportSenderRole;
  context: SupportContext | null;
  createdAt: TimestampLike;
}

/**
 * The document id of a support thread: the customer's uid for a customer thread, `store_{storeId}` for
 * a store's thread, which all its members share. The security rules build the same ids (§6.3).
 */
export function supportThreadId(kind: SupportThreadKind, ownerId: string): string {
  switch (kind) {
    case 'customer':
      return ownerId;
    case 'store':
      return `store_${ownerId}`;
    default: {
      // A thread id decides who can read the chat, so an unknown kind must not fall back to a guess.
      const unknown: never = kind;
      throw new Error(`Unknown support thread kind: ${String(unknown)}`);
    }
  }
}
