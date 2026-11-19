/** Push channels and preferences (docs/PLATFORM.md §10.2; the unchanged rules of MARKETPLACE §5.8). */
import type { NotificationType, Role, UserPreferences } from '@instasupply/shared';

export type PushChannel = 'jobs' | 'assignments' | 'orders' | 'store' | 'chat' | 'updates';

export function channelFor(type: NotificationType): PushChannel {
  if (type.startsWith('job_')) return 'jobs';
  if (type === 'delivery_assigned' || type === 'delivery_unassigned' || type === 'delivery_cancelled')
    return 'assignments';
  if (
    type.startsWith('order_') ||
    type === 'pickup_ready' ||
    type === 'refund_issued' ||
    type === 'quote_update' ||
    type === 'issue_update'
  ) {
    return 'orders';
  }
  if (type.startsWith('store_order_') || type === 'store_issue') return 'store';
  if (type === 'chat_message' || type.startsWith('support_')) return 'chat';
  return 'updates';
}

/** A missing preference means true; promoPush is opt-in and gates nothing transactional. */
export function pushAllowed(
  type: NotificationType,
  role: Role | null,
  preferences: UserPreferences | undefined,
): boolean {
  const prefs = preferences ?? {};
  const on = (value: boolean | undefined) => value !== false;
  switch (channelFor(type)) {
    case 'jobs':
      return on(prefs.jobPush);
    case 'store':
      return on(prefs.storeOrderPush);
    case 'orders':
      return on(prefs.orderPush);
    case 'chat':
      return on(prefs.chatPush);
    default:
      break;
  }
  if (type.startsWith('delivery_') && role !== 'driver') return on(prefs.deliveryPush);
  return true;
}
