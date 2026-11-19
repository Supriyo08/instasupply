/**
 * Wires notifications into the app: push registration, foreground presentation, deep links
 * from taps, and an in-app banner for new inbox items (works even where push can't).
 */
import { COLLECTIONS, type AppNotification } from '@instasupply/shared';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';

import { markRead, notificationHref } from './hooks';
import { registerForPush } from './push';
import { useToast } from './ToastProvider';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // The in-app banner already covers foreground alerts.
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export function NotificationsBridge({ uid }: { uid: string }) {
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);

  // Push registration (and re-registration when the platform rotates the token).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void registerForPush(uid);
    const subscription = Notifications.addPushTokenListener(() => void registerForPush(uid));
    return () => subscription.remove();
  }, [uid]);

  // Taps on system notifications, including the one that launched the app.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (data: Record<string, unknown> | undefined) => {
      const href = notificationHref(data);
      if (typeof data?.notificationId === 'string') void markRead(data.notificationId).catch(() => undefined);
      if (href) router.push(href as never);
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    );
    return () => subscription.remove();
  }, []);

  // In-app banner for anything new that lands in the inbox while the app is open.
  useEffect(() => {
    seen.current = null;
    const latest = query(
      collection(db, COLLECTIONS.notifications),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    return onSnapshot(latest, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AppNotification);
      if (!seen.current) {
        seen.current = new Set(items.map((item) => item.id));
        return;
      }
      const fresh = items.filter((item) => !seen.current!.has(item.id) && !item.read);
      fresh.forEach((item) => seen.current!.add(item.id));
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
          const href = notificationHref({ ...newest.data, type: newest.type });
          if (href) router.push(href as never);
        },
      });
    });
  }, [uid, toast]);

  return null;
}
