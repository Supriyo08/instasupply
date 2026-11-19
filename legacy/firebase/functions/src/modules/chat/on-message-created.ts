import { COLLECTIONS, type ChatMessage } from '@instasupply/shared';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { db, FieldValue, serverTimestamp } from '../../lib/admin';
import { baseOptions } from '../../lib/functions';
import { getUserProfile } from '../../lib/users';
import { notifyStaff, notifyUser } from '../notifications/notify';

/** Keeps the thread summary and unread counters current, and notifies the other side. */
export const onChatMessageCreated = onDocumentCreated(
  { ...baseOptions, document: `${COLLECTIONS.threads}/{driverId}/${COLLECTIONS.messages}/{messageId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const { driverId, messageId } = event.params;
    const message = snapshot.data() as Omit<ChatMessage, 'id'>;
    const driver = await getUserProfile(driverId);
    const driverName = driver?.displayName ?? 'Driver';
    const fromDriver = message.senderRole === 'driver';

    await db
      .collection(COLLECTIONS.threads)
      .doc(driverId)
      .set(
        {
          driverId,
          driverName,
          lastMessage: {
            text: message.text.slice(0, 140),
            senderId: message.senderId,
            senderRole: message.senderRole,
            at: message.createdAt ?? serverTimestamp(),
          },
          [fromDriver ? 'unreadByStaff' : 'unreadByDriver']: FieldValue.increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

    const notification = {
      type: 'chat_message' as const,
      body: message.text.slice(0, 200),
      data: { threadId: driverId, ...(message.deliveryId ? { deliveryId: message.deliveryId } : {}) },
      key: `chat-${messageId}`,
    };
    if (fromDriver) {
      await notifyStaff({ ...notification, title: driverName });
    } else {
      await notifyUser(driverId, { ...notification, title: `Dispatch · ${message.senderName}` });
    }
  },
);
