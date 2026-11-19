/**
 * Creating a notification document is the only way to notify someone. The document is the
 * in-app inbox entry, and `onNotificationCreated` turns it into push messages.
 */
import { COLLECTIONS, type NotificationType } from '@instasupply/shared';

import { db, serverTimestamp } from '../../lib/admin';
import { errorCode } from '../../lib/errors';
import { getActiveStaffIds } from '../../lib/users';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Inbox only, no push (for low-urgency updates). */
  silent?: boolean;
  /**
   * Idempotency key, typically derived from the trigger event id. Triggers are delivered at least
   * once, so a retried event must not notify twice.
   */
  key?: string;
}

const notificationsCol = () => db.collection(COLLECTIONS.notifications);

function toDocument(userId: string, input: NotificationInput) {
  return {
    userId,
    type: input.type,
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 500),
    data: input.data ?? {},
    read: false,
    createdAt: serverTimestamp(),
    push: {
      status: input.silent ? 'skipped' : 'pending',
      successCount: 0,
      failureCount: 0,
    },
  };
}

const isAlreadyExists = (error: unknown) => {
  const code = errorCode(error) || String((error as { code?: unknown })?.code ?? '');
  return code === '6' || code === 'already-exists' || code.endsWith('ALREADY_EXISTS');
};

export async function notifyUser(userId: string, input: NotificationInput): Promise<void> {
  if (!userId) return;
  if (!input.key) {
    await notificationsCol().add(toDocument(userId, input));
    return;
  }
  try {
    await notificationsCol().doc(`${input.key}_${userId}`).create(toDocument(userId, input));
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

export async function notifyUsers(userIds: readonly string[], input: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean);
  await Promise.all(unique.map((userId) => notifyUser(userId, input)));
}

export async function notifyStaff(
  input: NotificationInput,
  options: { adminsOnly?: boolean; exclude?: string | null } = {},
): Promise<void> {
  const staffIds = await getActiveStaffIds({ adminsOnly: options.adminsOnly });
  await notifyUsers(
    staffIds.filter((id) => id !== options.exclude),
    input,
  );
}
