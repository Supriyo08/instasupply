import type { AppNotification } from '@instasupply/shared';
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import type { Href } from 'expo-router';
import { useMemo } from 'react';

import { api, queries } from '@/lib/api';

/** The inbox: newest first, a new notification is prepended by its live event (§6.5). */
export function useNotifications(uid: string) {
  const inbox = useLiveQuery(queries.notifications(uid));
  const unread = useMemo(() => inbox.data.filter((item) => !item.read).length, [inbox.data]);
  return { ...inbox, unread };
}

/** Optimistic "mark read" (§1.12). */
export function useMarkRead(uid: string) {
  return useApiMutation((client, id: string) => client.notifications.markRead(id), {
    optimistic: (cache, id) =>
      cache.patch<AppNotification[]>(queries.notifications(uid).key, (list) =>
        list.map((item) => (item.id === id ? { ...item, read: true } : item)),
      ),
  });
}

/** Optimistic "mark all read". */
export function useMarkAllRead(uid: string) {
  return useApiMutation((client) => client.notifications.markAllRead(), {
    optimistic: (cache) =>
      cache.patch<AppNotification[]>(queries.notifications(uid).key, (list) =>
        list.map((item) => (item.read ? item : { ...item, read: true })),
      ),
  });
}

/** Outside React (push taps, toasts). Failures are the caller's to ignore. */
export function markRead(id: string): Promise<void> {
  return api.notifications.markRead(id);
}

/**
 * Where a notification leads (docs/CLIENTS.md §6.4, driver rows; first match wins). One function for
 * system notification taps, in-app banners and inbox rows (merge the row's `type` into `data` first).
 */
export function notificationHref(data: Record<string, unknown> | null | undefined): Href {
  const value = (key: string) => (typeof data?.[key] === 'string' ? (data[key] as string) : null);
  const type = value('type');
  const deliveryId = value('deliveryId');
  if (value('threadId')) return '/chat';
  if (type === 'job_offer' && deliveryId) return `/job/${deliveryId}`;
  if (value('payoutId')) return '/earnings';
  if (type === 'vehicle_review') return '/vehicle';
  if (deliveryId && type !== 'delivery_unassigned' && type !== 'delivery_cancelled') {
    return `/delivery/${deliveryId}`;
  }
  return '/notifications';
}

/** For an inbox row: its own `type` joins the payload before routing. */
export function hrefForNotification(item: Pick<AppNotification, 'type' | 'data'>): Href {
  return notificationHref({ ...item.data, type: item.type });
}
