import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

import { notificationData, notificationHref, useNotifications } from './hooks';
import { useToast } from './ToastProvider';
import { usePushListeners } from './usePushListeners';

/**
 * Push registration, taps on system notifications, and the in-app banner for new notifications
 * (docs/CLIENTS.md §6.5). Mounted by the shop layout only while the session is `ready`.
 */
export function NotificationsBridge({ uid }: { uid: string }) {
  const toast = useToast();
  const inbox = useNotifications(uid);
  const seen = useRef<Set<string> | null>(null);

  usePushListeners(uid);

  useEffect(() => {
    seen.current = null;
  }, [uid]);

  useEffect(() => {
    if (inbox.loading || inbox.error) return;
    // The first loaded result only fills the set; afterwards each new unread id raises one banner.
    if (!seen.current) {
      seen.current = new Set(inbox.data.map((item) => item.id));
      return;
    }
    const known = seen.current;
    const fresh = inbox.data.filter((item) => !known.has(item.id) && !item.read);
    inbox.data.forEach((item) => known.add(item.id));
    const newest = fresh[0];
    if (!newest) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({
      title: newest.title,
      body: newest.body,
      icon: newest.type === 'order_delivered' ? 'check-circle' : 'truck',
      onPress: () => {
        void api.notifications.markRead(newest.id).catch(() => undefined);
        router.push(notificationHref(notificationData(newest)) as Href);
      },
    });
  }, [inbox.data, inbox.loading, inbox.error, toast]);

  return null;
}
