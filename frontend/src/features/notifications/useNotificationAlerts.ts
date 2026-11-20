import type { AppNotification } from '@instasupply/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useToast } from '@/components/ui/Toast';

import { freshIds, isNotificationAlertClaimed } from './alert-state';
import { notificationHref, type LinkAudience } from './notification-links';

const supported = typeof window !== 'undefined' && 'Notification' in window;

const ERROR_TYPES = new Set<AppNotification['type']>([
  'delivery_failed',
  'delivery_declined',
  'store_order_late',
  'capture_failed',
  'job_unclaimed',
]);

/**
 * A toast (and a desktop notification while the tab is hidden) for every notification that arrives
 * after the page loaded. The first successful answer is not announced (an initial error is not an
 * answer). Types a mounted screen announces itself (`claimNotificationAlerts`, the portal board's
 * `store_order_new`) are skipped so nothing is announced twice.
 */
export function useNotificationAlerts(
  notifications: readonly AppNotification[],
  loading: boolean,
  audience: LinkAudience,
  error: unknown = null,
) {
  const toast = useToast();
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );

  useEffect(() => {
    if (loading || error) return;
    const next = freshIds(
      seen.current,
      notifications.map((item) => item.id),
    );
    seen.current = next.known;
    const freshSet = new Set(next.fresh);
    const fresh = notifications.filter(
      (item) => freshSet.has(item.id) && !item.read && !isNotificationAlertClaimed(item.type),
    );

    for (const item of fresh.slice(0, 3)) {
      const link = notificationHref(item, audience);
      toast.show({
        tone: ERROR_TYPES.has(item.type) ? 'error' : 'info',
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
  }, [audience, error, loading, navigate, notifications, toast]);

  const requestPermission = useCallback(async () => {
    if (!supported) return;
    setPermission(await Notification.requestPermission());
  }, []);

  return { permission, requestPermission };
}
