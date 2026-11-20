/**
 * SQL of the inbox (docs/PLATFORM.md §3.3, §5.3.3): `notifications` has typed columns only; the serializer
 * builds `AppNotification` with `push = { status, successCount, failureCount, sentAt }`. `dedupe_key` is
 * private. The insert itself is statement (g) in notify.ts.
 */
import type { AppNotification, NotificationType, PushStatus } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  read: boolean;
  read_at: number | null;
  push_status: PushStatus;
  push_success: number;
  push_failure: number;
  push_sent_at: number | null;
  created_at: number;
}

const COLUMNS = `id, user_id, type, title, body, data, read, read_at, push_status, push_success, push_failure,
  push_sent_at, created_at`;

export const toNotification = (row: NotificationRow): AppNotification => ({
  id: row.id,
  userId: row.user_id,
  type: row.type,
  title: row.title,
  body: row.body,
  data: row.data,
  read: row.read,
  createdAt: row.created_at,
  readAt: row.read_at,
  push: {
    status: row.push_status,
    successCount: row.push_success,
    failureCount: row.push_failure,
    sentAt: row.push_sent_at,
  },
});

export const notificationCursorKey = (row: NotificationRow): [number, string] => [row.created_at, row.id];

/** The caller's inbox, newest first (notifications_user_idx). */
export async function listNotifications(
  db: Queryable,
  userId: string,
  filter: { unread: boolean },
  after: [number, string] | null,
  limit: number,
): Promise<NotificationRow[]> {
  const { rows } = await db.query<NotificationRow>(
    `SELECT ${COLUMNS} FROM notifications
      WHERE user_id = $1 AND (NOT $2::boolean OR NOT read)
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::text))
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [userId, filter.unread, after ? new Date(after[0]) : null, after ? after[1] : null, limit + 1],
  );
  return rows;
}

/** notifications_unread_idx. */
export async function countUnread(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND NOT read`,
    [userId],
  );
  return rows[0]?.count ?? 0;
}

export async function findRecipient(db: Queryable, id: string): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(`SELECT user_id FROM notifications WHERE id = $1`, [
    id,
  ]);
  return rows[0]?.user_id ?? null;
}

/** Sets `read` and `readAt` once; nothing else of a notification can change. */
export async function markRead(tx: Tx, id: string, userId: string): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE notifications SET read = true, read_at = $3 WHERE id = $1 AND user_id = $2 AND NOT read`,
    [id, userId, new Date(tx.now)],
  );
  if (rowCount > 0) await publishChange(tx, 'notifications', 'updated', { id, userId });
}

export async function markAllRead(tx: Tx, userId: string): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE notifications SET read = true, read_at = $2 WHERE user_id = $1 AND NOT read`,
    [userId, new Date(tx.now)],
  );
  // One invalidation for the whole inbox: the client refetches the list and the count.
  if (rowCount > 0) await publishChange(tx, 'notifications', 'updated', { id: 'read-all', userId });
  return rowCount;
}

export async function deleteNotification(tx: Tx, id: string, userId: string): Promise<void> {
  const { rowCount } = await tx.query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  if (rowCount > 0) await publishChange(tx, 'notifications', 'deleted', { id, userId });
}

/** sendTestNotification answers how many push devices the caller has. */
export async function countDevices(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM devices WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.count ?? 0;
}
