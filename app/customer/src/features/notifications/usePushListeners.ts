/** System push on iOS and Android (docs/CLIENTS.md §6.4). The browser gets ./usePushListeners.web. */
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';

import { notificationHref, type NotificationData } from './hooks';
import { onPushTokenChange, registerForPush } from './push';
import { pushAvailability } from './push-availability';

// Safe in Expo Go and without push credentials: it only sets the foreground presentation.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false, // the in-app banner covers foreground alerts
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Taps this process has dealt with. The OS keeps reporting the last tap and the listeners mount
 * again on every sign-in, so without this an old order would reopen.
 */
const handledTaps = new Set<string>();

function lastTap(): Notifications.NotificationResponse | null {
  try {
    return Notifications.getLastNotificationResponse();
  } catch {
    return null;
  }
}

function asData(raw: unknown): NotificationData {
  const data: NotificationData = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') data[key] = value;
    }
  }
  return data;
}

function openTapped(response: Notifications.NotificationResponse, uid: string) {
  const { identifier, content } = response.notification.request;
  const data = asData(content.data);
  const notificationId = data.notificationId ?? '';
  // The OS reuses an identifier when one notification replaces another, so pair it with our id.
  const tap = `${identifier}/${notificationId}`;
  if (handledTaps.has(tap)) return;
  handledTaps.add(tap);
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Not offered by this native build: the set above still stops a replay.
  }
  // A push sent to whoever used this phone before is not this customer's to open.
  if (data.userId && data.userId !== uid) return;
  if (notificationId) void api.notifications.markRead(notificationId).catch(() => undefined);
  router.push(notificationHref(data) as Href);
}

/** Registers this device silently (permission granted earlier) and opens tapped notifications. */
export function usePushListeners(uid: string) {
  useEffect(() => {
    void registerForPush({ prompt: false });
    return onPushTokenChange(() => void registerForPush({ prompt: false }));
  }, [uid]);

  useEffect(() => {
    if (!pushAvailability().available) return;
    const launchTap = lastTap();
    if (launchTap) openTapped(launchTap, uid);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      openTapped(response, uid),
    );
    return () => subscription.remove();
  }, [uid]);
}
