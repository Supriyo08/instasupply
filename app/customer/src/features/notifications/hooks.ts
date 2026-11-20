import { queries } from '@instasupply/api-client';
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import type { AppNotification } from '@instasupply/shared';

/** The inbox, newest 50, live: a new notification arrives as a payload and is prepended at once. */
export function useNotifications(uid: string | null | undefined) {
  const result = useLiveQuery(queries.notifications(uid));
  return { ...result, unread: result.data.filter((item) => !item.read).length };
}

/** `markRead` and `markAllRead`, with the optimistic patch of docs/CLIENTS.md §4.2. */
export function useNotificationActions(uid: string | null | undefined) {
  const key = queries.notifications(uid).key;
  const markRead = useApiMutation<string, unknown>((api, id) => api.notifications.markRead(id), {
    optimistic: (cache, id) =>
      cache.patch<AppNotification[]>(key, (items) =>
        items.map((item) => (item.id === id ? { ...item, read: true } : item)),
      ),
  });
  const markAllRead = useApiMutation<void, unknown>((api) => api.notifications.markAllRead(), {
    optimistic: (cache) =>
      cache.patch<AppNotification[]>(key, (items) => items.map((item) => ({ ...item, read: true }))),
  });
  return { markRead, markAllRead };
}

/** The data a deep link reads: the push `data`, or an inbox row's `data` with its `type` merged in. */
export type NotificationData = Record<string, string | undefined>;

const str = (value: string | undefined): string | null => (typeof value === 'string' && value ? value : null);

/**
 * Where a notification opens (docs/CLIENTS.md §6.4, customer rows; first match wins). The same
 * function serves system notifications, in-app banners and inbox rows.
 */
export function notificationHref(data: NotificationData | null | undefined): string {
  if (!data) return '/notifications';
  const issueId = str(data.issueId);
  if (issueId) return `/issues/${issueId}`;
  const quoteId = str(data.quoteId);
  if (quoteId) return `/quotes/${quoteId}`;
  if (str(data.threadId)) return '/support';
  const orderId = str(data.customerOrderId);
  const storeOrderId = str(data.storeOrderId);
  if (orderId && storeOrderId && str(data.deliveryId)) return `/orders/${orderId}/track/${storeOrderId}`;
  if (orderId) return `/orders/${orderId}`;
  return '/notifications';
}

/** An inbox row as deep-link data: its `data` plus its `type`. */
export function notificationData(item: AppNotification): NotificationData {
  return { ...item.data, type: item.type };
}
