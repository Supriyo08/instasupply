import type { AppNotification } from '@instasupply/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useToast } from '@/components/ui/Toast';
import type { WithId } from '@/lib/firebase/hooks';

import { notificationLink } from './useNotifications';

const supported = typeof window !== 'undefined' && 'Notification' in window;

/**
 * Shows a toast (and a desktop notification when the tab is in the background) for every
 * notification that arrives after the app loaded. The initial snapshot is not announced.
 */
export function useNotificationAlerts(notifications: WithId<AppNotification>[], loading: boolean) {
  const toast = useToast();
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );

  useEffect(() => {
    if (loading) return;
    if (!seen.current) {
      seen.current = new Set(notifications.map((item) => item.id));
      return;
    }
    const fresh = notifications.filter((item) => !seen.current!.has(item.id));
    fresh.forEach((item) => seen.current!.add(item.id));

    for (const item of fresh.filter((notification) => !notification.read).slice(0, 3)) {
      const link = notificationLink(item);
      toast.show({
        tone: item.type === 'delivery_failed' || item.type === 'delivery_declined' ? 'error' : 'info',
        title: item.title,
        description: item.body,
        action: link ? { label: 'View', onClick: () => navigate(link) } : undefined,
      });
      if (supported && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        const desktop = new Notification(item.title, { body: item.body, tag: item.id, icon: '/favicon.svg' });
        desktop.onclick = () => {
          window.focus();
          if (link) navigate(link);
          desktop.close();
        };
      }
    }
  }, [loading, navigate, notifications, toast]);

  const requestPermission = useCallback(async () => {
    if (!supported) return;
    setPermission(await Notification.requestPermission());
  }, []);

  return { permission, requestPermission };
}
