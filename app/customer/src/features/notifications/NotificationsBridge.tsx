import { COLLECTIONS, type AppNotification } from '@instasupply/shared';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';

import { markRead, notificationHref } from './hooks';
import { useToast } from './ToastProvider';
import { usePushListeners } from './usePushListeners';

/** Push registration, taps on system notifications, and live in-app banners for order updates. */
export function NotificationsBridge({ uid }: { uid: string }) {
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);

  usePushListeners(uid);

  useEffect(() => {
    seen.current = null;
    const latest = query(
      collection(db, COLLECTIONS.notifications),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    return onSnapshot(latest, (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AppNotification);
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
        icon: newest.type === 'order_delivered' ? 'check-circle' : 'truck',
        onPress: () => {
          void markRead(newest.id).catch(() => undefined);
          router.push(notificationHref(newest.data) as never);
        },
      });
    });
  }, [uid, toast]);

  return null;
}
