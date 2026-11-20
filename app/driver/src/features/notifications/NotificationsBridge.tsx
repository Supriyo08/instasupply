/**
 * Notifications inside the approved area (docs/CLIENTS.md §6.2, §6.4, §6.5): the system permission
 * prompt on entering `(app)`, taps on system notifications, and an in-app banner for each new inbox
 * item, which works without push (the inbox is a live query on `user:{uid}:notifications`).
 */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { hrefForNotification, markRead, useNotifications } from './hooks';
import { registerForPush } from './push';
import { useToast } from './ToastProvider';
import { usePushListeners } from './usePushListeners';

export function NotificationsBridge({ uid }: { uid: string }) {
  const toast = useToast();
  const inbox = useNotifications(uid);
  const seen = useRef<Set<string> | null>(null);

  // Job offers and dispatch messages are the product: ask on entering the approved area (§6.2).
  useEffect(() => {
    void registerForPush({ prompt: true }).catch(() => undefined);
  }, [uid]);

  usePushListeners(uid);

  // The first loaded result only fills the "seen" set; afterwards each unseen unread id raises one toast.
  useEffect(() => {
    seen.current = null;
  }, [uid]);
  const items = inbox.data;
  const loaded = inbox.updatedAt !== null;
  useEffect(() => {
    if (!loaded) return;
    if (!seen.current) {
      seen.current = new Set(items.map((item) => item.id));
      return;
    }
    const known = seen.current;
    const fresh = items.filter((item) => !known.has(item.id) && !item.read);
    for (const item of items) known.add(item.id);
    const newest = fresh[0];
    if (!newest) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({
      title: newest.title,
      body: newest.body,
      tone:
        newest.type === 'delivery_cancelled' || newest.type === 'delivery_unassigned' ? 'warning' : 'brand',
      onPress: () => {
        void markRead(newest.id).catch(() => undefined);
        router.push(hrefForNotification(newest));
      },
    });
  }, [items, loaded, toast]);

  return null;
}
