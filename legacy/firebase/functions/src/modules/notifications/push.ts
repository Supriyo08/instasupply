/**
 * Push fan-out. Each user can have several devices; each device token is either a native FCM
 * token or an Expo push token. Invalid tokens are deleted so they don't cost us again.
 */
import {
  COLLECTIONS,
  type AppNotification,
  type DeviceRegistration,
  type NotificationType,
  type PushStatus,
} from '@instasupply/shared';
import type { DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { isEmulator, settings } from '../../config/runtime';
import { db, messaging } from '../../lib/admin';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Android notification channel per notification type (the apps create these channels). */
export function channelFor(type: NotificationType): 'assignments' | 'chat' | 'updates' | 'orders' {
  if (type.startsWith('order_')) return 'orders';
  if (type === 'delivery_assigned' || type === 'delivery_cancelled' || type === 'delivery_unassigned') {
    return 'assignments';
  }
  if (type === 'chat_message') return 'chat';
  return 'updates';
}

interface DeviceRecord extends DeviceRegistration {
  ref: DocumentReference;
}

interface PushOutcome {
  status: PushStatus;
  successCount: number;
  failureCount: number;
}

type PushPayload = Pick<AppNotification, 'type' | 'title' | 'body' | 'data'> & { id: string };

export async function sendPushToUser(userId: string, notification: PushPayload): Promise<PushOutcome> {
  const snapshot = await db.collection(COLLECTIONS.users).doc(userId).collection(COLLECTIONS.devices).get();
  const devices: DeviceRecord[] = snapshot.docs.map((doc) => ({
    ...(doc.data() as DeviceRegistration),
    ref: doc.ref,
  }));
  if (devices.length === 0) return { status: 'no_devices', successCount: 0, failureCount: 0 };

  const data: Record<string, string> = {
    ...notification.data,
    notificationId: notification.id,
    type: notification.type,
    // Lets the app ignore a tap on a push that was meant for another account on the same phone.
    userId,
  };

  const [fcm, expo] = await Promise.all([
    sendFcm(
      devices.filter((device) => device.provider === 'fcm'),
      notification,
      data,
    ),
    sendExpo(
      devices.filter((device) => device.provider === 'expo'),
      notification,
      data,
    ),
  ]);

  const successCount = fcm.success + expo.success;
  const failureCount = fcm.failure + expo.failure;
  const stale = [...fcm.stale, ...expo.stale];
  if (stale.length > 0) {
    const batch = db.batch();
    stale.forEach((device) => batch.delete(device.ref));
    await batch.commit();
    logger.info('Removed invalid push tokens', { userId, count: stale.length });
  }

  const status: PushStatus =
    successCount > 0 && failureCount === 0
      ? 'sent'
      : successCount > 0
        ? 'partial'
        : fcm.skipped && expo.attempted === 0
          ? 'skipped'
          : 'failed';
  return { status, successCount, failureCount };
}

async function sendFcm(devices: DeviceRecord[], notification: PushPayload, data: Record<string, string>) {
  const result = { success: 0, failure: 0, stale: [] as DeviceRecord[], skipped: false };
  if (devices.length === 0) return result;
  if (isEmulator) {
    // The emulator has no FCM credentials; Expo push still works locally.
    logger.info('Emulator: skipping FCM delivery', { devices: devices.length, title: notification.title });
    result.skipped = true;
    return result;
  }

  const channelId = channelFor(notification.type);
  const response = await messaging().sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    notification: { title: notification.title, body: notification.body },
    data,
    android: {
      priority: 'high',
      notification: { channelId, sound: 'default', tag: data.deliveryId ?? data.threadId },
    },
    apns: { payload: { aps: { sound: 'default', threadId: data.threadId ?? channelId } } },
    webpush: { fcmOptions: { link: data.link ?? '/' } },
  });

  response.responses.forEach((item, index) => {
    if (item.success) {
      result.success += 1;
      return;
    }
    result.failure += 1;
    const code = item.error?.code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    ) {
      result.stale.push(devices[index]!);
    }
  });
  return result;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

async function sendExpo(devices: DeviceRecord[], notification: PushPayload, data: Record<string, string>) {
  const result = { success: 0, failure: 0, stale: [] as DeviceRecord[], attempted: devices.length };
  if (devices.length === 0) return result;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (settings.expoAccessToken) headers.Authorization = `Bearer ${settings.expoAccessToken}`;

  // Expo accepts up to 100 messages per request.
  for (let start = 0; start < devices.length; start += 100) {
    const chunk = devices.slice(start, start + 100);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          chunk.map((device) => ({
            to: device.token,
            title: notification.title,
            body: notification.body,
            data,
            sound: 'default',
            priority: 'high',
            channelId: channelFor(notification.type),
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = payload.data ?? [];
      chunk.forEach((device, index) => {
        const ticket = tickets[index];
        if (ticket?.status === 'ok') {
          result.success += 1;
        } else {
          result.failure += 1;
          if (ticket?.details?.error === 'DeviceNotRegistered') result.stale.push(device);
        }
      });
    } catch (error) {
      result.failure += chunk.length;
      logger.warn('Expo push request failed', { error: error instanceof Error ? error.message : error });
    }
  }
  return result;
}
