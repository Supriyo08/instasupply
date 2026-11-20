/**
 * Taps on system notifications (docs/CLIENTS.md §6.4), mounted while the session is `ready`.
 * `usePushListeners.web.ts` replaces it on the web.
 */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { markRead, notificationHref } from './hooks';
import { pushAvailability } from './push-availability';

/** Keys handled in this process, so the launch tap is not opened twice (fast refresh, remount). */
const handled = new Set<string>();

export function usePushListeners(uid: string): void {
  useEffect(() => {
    if (!pushAvailability().available) return;
    const open = (response: Notifications.NotificationResponse) => {
      const request = response.notification.request;
      const data = (request.content.data ?? {}) as Record<string, unknown>;
      const notificationId = typeof data.notificationId === 'string' ? data.notificationId : '';
      const key = `${request.identifier}/${notificationId}`;
      if (handled.has(key)) return;
      handled.add(key);
      Notifications.clearLastNotificationResponse();
      // A push for the previous account on this phone opens nothing (§2.6).
      if (typeof data.userId === 'string' && data.userId !== uid) return;
      if (notificationId) void markRead(notificationId).catch(() => undefined);
      router.push(notificationHref(data));
    };
    const launch = Notifications.getLastNotificationResponse();
    if (launch) open(launch);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [uid]);
}
