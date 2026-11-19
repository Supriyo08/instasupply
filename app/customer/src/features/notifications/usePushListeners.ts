/** System push on iOS and Android. The browser gets ./usePushListeners.web instead. */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { markRead, notificationHref } from './hooks';
import { registerForPush } from './push';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false, // the in-app banner covers foreground alerts
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Notification taps this app process has already dealt with. The OS keeps reporting the last tap
 * and the signed-in area mounts again on every sign-in, so without this an old order would reopen.
 */
const handledTaps = new Set<string>();

/** The tap that launched the app, or one made while signed out, is only kept as the last response. */
function lastTap(): Notifications.NotificationResponse | null {
  try {
    return Notifications.getLastNotificationResponse();
  } catch {
    return null; // not offered by this native build: taps made while the app runs still arrive
  }
}

function openTapped(response: Notifications.NotificationResponse, uid: string) {
  const { identifier, content } = response.notification.request;
  const data = content.data;
  const notificationId = typeof data?.notificationId === 'string' ? data.notificationId : '';
  // The OS reuses an identifier when one notification replaces another, so pair it with our id.
  const tap = `${identifier}/${notificationId}`;
  if (handledTaps.has(tap)) return;
  handledTaps.add(tap);
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Not offered by this native build: the set above still stops a replay.
  }
  // A push sent to whoever used this phone before is not this shopper's to open.
  if (typeof data?.userId === 'string' && data.userId !== uid) return;
  if (notificationId) void markRead(notificationId).catch(() => undefined);
  router.push(notificationHref(data) as never);
}

/** Registers this device for push and opens the order behind a tapped system notification. */
export function usePushListeners(uid: string) {
  useEffect(() => {
    void registerForPush(uid);
    const subscription = Notifications.addPushTokenListener(() => void registerForPush(uid));
    return () => subscription.remove();
  }, [uid]);

  useEffect(() => {
    const launchTap = lastTap();
    if (launchTap) openTapped(launchTap, uid);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      openTapped(response, uid),
    );
    return () => subscription.remove();
  }, [uid]);
}
