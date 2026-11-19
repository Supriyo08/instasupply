import { COLLECTIONS, type AppNotification, type UserProfile } from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { db, serverTimestamp } from '../../lib/admin';
import { baseOptions, callable } from '../../lib/functions';
import { requireAuth } from '../../lib/guards';
import { getUserProfile } from '../../lib/users';
import { notifyUser } from './notify';
import { sendPushToUser } from './push';

function pushAllowed(notification: AppNotification, profile: UserProfile | null): boolean {
  const preferences = profile?.preferences ?? {};
  if (notification.type === 'chat_message') return preferences.chatPush !== false;
  if (notification.type.startsWith('order_')) return preferences.orderPush !== false;
  if (profile?.role !== 'driver' && notification.type.startsWith('delivery_')) {
    return preferences.deliveryPush !== false;
  }
  return true;
}

/** Turns every new inbox notification into push messages on the recipient's devices. */
export const onNotificationCreated = onDocumentCreated(
  { ...baseOptions, document: `${COLLECTIONS.notifications}/{notificationId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const notification = { id: snapshot.id, ...snapshot.data() } as AppNotification;
    if (notification.push?.status !== 'pending') return;

    const profile = await getUserProfile(notification.userId);
    if (!pushAllowed(notification, profile)) {
      await snapshot.ref.update({ 'push.status': 'skipped' });
      return;
    }

    const outcome = await sendPushToUser(notification.userId, notification);
    await snapshot.ref.update({
      'push.status': outcome.status,
      'push.successCount': outcome.successCount,
      'push.failureCount': outcome.failureCount,
      'push.sentAt': serverTimestamp(),
    });
    logger.info('Notification delivered', {
      notificationId: notification.id,
      userId: notification.userId,
      type: notification.type,
      ...outcome,
    });
  },
);

/** Lets a signed-in user check that push works on their devices. */
export const sendTestNotification = callable<void, { devices: number }>(
  'sendTestNotification',
  async (request) => {
    const actor = requireAuth(request);
    const devices = await db
      .collection(COLLECTIONS.users)
      .doc(actor.uid)
      .collection(COLLECTIONS.devices)
      .count()
      .get();
    await notifyUser(actor.uid, {
      type: 'test',
      title: 'Test notification',
      body: 'Push notifications are working on this device.',
    });
    return { devices: devices.data().count };
  },
);
