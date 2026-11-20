/**
 * Where a notification takes the console user (docs/CLIENTS.md §6.4, console rows). One function for
 * the bell, the toasts and desktop notifications; first match wins. The console has no system push in
 * P0 (web push for the portal is P1, MARKETPLACE §14.6), so there is no device registration here.
 */
import type { AppNotification } from '@instasupply/shared';

export type LinkAudience = 'staff' | 'supplier';

type Linkable = Pick<AppNotification, 'data'> & Partial<Pick<AppNotification, 'type'>>;

export function notificationHref(notification: Linkable, audience: LinkAudience): string | null {
  // Inbox rows: the item's own type is merged into its data first.
  const data: Record<string, string | undefined> = {
    ...(notification.data ?? {}),
    ...(notification.type ? { type: notification.type } : {}),
  };
  const enc = (value: string) => encodeURIComponent(value);

  if (audience === 'supplier') {
    if (data.storeOrderId) return `/portal/orders/${enc(data.storeOrderId)}`;
    if (data.threadId) return '/portal/support';
    if (data.payoutId) return '/portal/payouts';
    return null;
  }

  const type = data.type ?? '';
  if (type === 'chat_message' && data.threadId) return `/messages/${enc(data.threadId)}`;
  if (type.startsWith('support_') && data.threadId) return `/support/${enc(data.threadId)}`;
  if (data.quoteId) return `/quotes/${enc(data.quoteId)}`;
  if (data.issueId) return `/issues/${enc(data.issueId)}`;
  if (data.customerOrderId) return `/orders/${enc(data.customerOrderId)}`;
  if (data.deliveryId) return `/deliveries/${enc(data.deliveryId)}`;
  if (data.driverId) return `/drivers/${enc(data.driverId)}`;
  if (data.payoutId) return '/payouts';
  if (type === 'store_suggestion') return '/suggestions';
  return null;
}
