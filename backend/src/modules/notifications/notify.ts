/**
 * The in-app inbox writers (docs/PLATFORM.md §9.1, §10.2), owned by `money-comms` (§15.2); the signatures are
 * frozen. `notify` inserts the row with statement (g) of §3.5 in the caller's transaction: a second insert with
 * the same `key` for the same user does nothing, so a retried command or job cannot notify twice (the key
 * table of §10.2). An inserted row is published on `user:{uid}:notifications` and, unless silent, enqueues
 * `push.send` (dedupe key `push:{notificationId}`). `notifyStaff` reads active staff (index 35) and
 * `notifyStoreMembers` the active supplier users of a store (index 37) inside the transaction.
 */
import type { AppNotification, NotificationType } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { newId } from '../../platform/ids';
import { publishChange } from '../../platform/live/publish';
import { enqueue } from '../../platform/outbox/outbox';

export interface NotificationInput {
  type: NotificationType;
  /** Cut to 120. */
  title: string;
  /** Cut to 500. */
  body: string;
  /** Deep-link keys (NOTIFICATION_DATA_KEYS); strings, as the Expo push service carries them. */
  data?: Record<string, string>;
  /** Inbox only, push_status 'skipped'. */
  silent?: boolean;
  /** Dedupe key; a second insert with the same key for the same user does nothing. */
  key?: string;
}

const cut = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export async function notify(tx: Tx, userId: string, input: NotificationInput): Promise<void> {
  const id = newId();
  const title = cut(input.title, 120);
  const body = cut(input.body, 500);
  const data = input.data ?? {};
  const pushStatus = input.silent ? 'skipped' : 'pending';
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO notifications (id, user_id, dedupe_key, type, title, body, data, push_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [
      id,
      userId,
      input.key ?? null,
      input.type,
      title,
      body,
      JSON.stringify(data),
      pushStatus,
      new Date(tx.now),
    ],
  );
  if (rows.length === 0) return;
  const notification: AppNotification = {
    id,
    userId,
    type: input.type,
    title,
    body,
    data,
    read: false,
    createdAt: tx.now,
    readAt: null,
    push: { status: pushStatus, successCount: 0, failureCount: 0, sentAt: null },
  };
  await publishChange(tx, 'notifications', 'created', notification);
  if (!input.silent) await enqueue(tx, 'push.send', { notificationId: id }, { dedupeKey: `push:${id}` });
}

export async function notifyUsers(
  tx: Tx,
  userIds: readonly string[],
  input: NotificationInput,
): Promise<void> {
  for (const userId of [...new Set(userIds)]) await notify(tx, userId, input);
}

/** Active staff (index 35), read inside the transaction. */
export async function notifyStaff(
  tx: Tx,
  input: NotificationInput,
  opts: { adminsOnly?: boolean; exclude?: string | null } = {},
): Promise<void> {
  const roles = opts.adminsOnly ? ['admin'] : ['admin', 'dispatcher'];
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM users WHERE role = ANY($1::text[]) AND status = 'active' ORDER BY id`,
    [roles],
  );
  await notifyUsers(
    tx,
    rows.map((row) => row.id).filter((id) => id !== opts.exclude),
    input,
  );
}

/** Active supplier users of the store (index 37). */
export async function notifyStoreMembers(
  tx: Tx,
  storeId: string,
  input: NotificationInput,
  opts: { ownersOnly?: boolean } = {},
): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM users WHERE store_id = $1 AND role = 'supplier' AND status = 'active'
       AND ($2::boolean IS FALSE OR store_role = 'owner') ORDER BY id`,
    [storeId, opts.ownersOnly === true],
  );
  await notifyUsers(
    tx,
    rows.map((row) => row.id),
    input,
  );
}

export async function notifyDrivers(
  tx: Tx,
  driverIds: readonly string[],
  input: NotificationInput,
): Promise<void> {
  await notifyUsers(tx, driverIds, input);
}
