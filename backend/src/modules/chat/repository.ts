/**
 * SQL of the dispatch ↔ driver chat (docs/PLATFORM.md §3.3): `chat_threads` (one per driver, keyed by the
 * driver's uid) and `chat_messages`, typed columns only. `seq` orders messages and never leaves the server.
 */
import type { ChatMessage, ChatSenderRole, ChatThread, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable | Tx;
async function rowsOf<R>(db: Db, text: string, values: unknown[]): Promise<R[]> {
  return (await (db as Tx).query<R>(text, values)).rows;
}

interface ThreadRow {
  driver_id: string;
  driver_name: string;
  last_message: ChatThread['lastMessage'];
  unread_by_driver: number;
  unread_by_staff: number;
  updated_at: number;
}

const THREAD_COLUMNS = 'driver_id, driver_name, last_message, unread_by_driver, unread_by_staff, updated_at';

export const toChatThread = (row: ThreadRow): WithId<ChatThread> => ({
  id: row.driver_id,
  driverId: row.driver_id,
  driverName: row.driver_name,
  lastMessage: row.last_message,
  unreadByDriver: row.unread_by_driver,
  unreadByStaff: row.unread_by_staff,
  updatedAt: row.updated_at,
});

export const threadCursorKey = (row: ThreadRow): [number, string] => [row.updated_at, row.driver_id];

export async function findChatThread(db: Db, driverId: string): Promise<WithId<ChatThread> | null> {
  const rows = await rowsOf<ThreadRow>(
    db,
    `SELECT ${THREAD_COLUMNS} FROM chat_threads WHERE driver_id = $1`,
    [driverId],
  );
  return rows[0] ? toChatThread(rows[0]) : null;
}

/** GET /threads: most recently updated first (chat_threads_updated_idx). */
export async function listChatThreads(
  db: Queryable,
  after: [number, string] | null,
  limit: number,
): Promise<ThreadRow[]> {
  return rowsOf<ThreadRow>(
    db,
    `SELECT ${THREAD_COLUMNS} FROM chat_threads
      WHERE ($1::timestamptz IS NULL OR (updated_at, driver_id) < ($1::timestamptz, $2::text))
      ORDER BY updated_at DESC, driver_id DESC LIMIT $3`,
    [after ? new Date(after[0]) : null, after ? after[1] : null, limit + 1],
  );
}

/** The driver's name, or null when the uid is not a driver. */
export async function driverName(db: Db, driverId: string): Promise<string | null> {
  const rows = await rowsOf<{ name: string }>(
    db,
    `SELECT display_name AS name FROM users WHERE id = $1 AND role = 'driver'`,
    [driverId],
  );
  return rows[0] ? rows[0].name || 'Driver' : null;
}

/** Created on the first message, then locked by the caller (rank 12). */
export async function ensureChatThread(tx: Tx, driverId: string, name: string): Promise<void> {
  await tx.query(
    `INSERT INTO chat_threads (driver_id, driver_name, created_at, updated_at) VALUES ($1, $2, $3, $3)
     ON CONFLICT (driver_id) DO NOTHING`,
    [driverId, name.slice(0, 80), new Date(tx.now)],
  );
}

export async function lockChatThread(tx: Tx, driverId: string): Promise<boolean> {
  const { rows } = await tx.query<{ driver_id: string }>(
    `SELECT driver_id FROM chat_threads WHERE driver_id = $1 FOR NO KEY UPDATE`,
    [driverId],
  );
  return rows.length > 0;
}

export async function applyMessageToChatThread(
  tx: Tx,
  driverId: string,
  input: { driverName: string; lastMessage: NonNullable<ChatThread['lastMessage']>; fromDriver: boolean },
): Promise<void> {
  await tx.query(
    `UPDATE chat_threads SET
       driver_name = $2,
       last_message = $3::jsonb,
       unread_by_staff = unread_by_staff + CASE WHEN $4::boolean THEN 1 ELSE 0 END,
       unread_by_driver = unread_by_driver + CASE WHEN $4::boolean THEN 0 ELSE 1 END,
       updated_at = $5
     WHERE driver_id = $1`,
    [
      driverId,
      input.driverName.slice(0, 80),
      JSON.stringify(input.lastMessage),
      input.fromDriver,
      new Date(tx.now),
    ],
  );
  await publishChange(tx, 'chat_threads', 'updated', { driverId });
}

export async function markChatThreadRead(tx: Tx, driverId: string, side: 'driver' | 'staff'): Promise<void> {
  const sql =
    side === 'driver'
      ? `UPDATE chat_threads SET unread_by_driver = 0, driver_read_at = $2 WHERE driver_id = $1`
      : `UPDATE chat_threads SET unread_by_staff = 0, staff_read_at = $2 WHERE driver_id = $1`;
  const { rowCount } = await tx.query(sql, [driverId, new Date(tx.now)]);
  if (rowCount > 0) await publishChange(tx, 'chat_threads', 'updated', { driverId });
}

interface MessageRow {
  id: string;
  thread_id: string;
  seq: number;
  sender_id: string;
  sender_name: string;
  sender_role: ChatSenderRole;
  text: string;
  delivery_id: string | null;
  kind: 'text' | 'quick_reply';
  created_at: number;
}

const MESSAGE_COLUMNS =
  'id, thread_id, seq, sender_id, sender_name, sender_role, text, delivery_id, kind, created_at';

export const toChatMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  text: row.text,
  senderId: row.sender_id,
  senderName: row.sender_name,
  senderRole: row.sender_role,
  deliveryId: row.delivery_id,
  kind: row.kind,
  createdAt: row.created_at,
});

export const messageCursorKey = (row: MessageRow): [number, string] => [row.seq, row.id];

export async function findChatMessage(
  db: Db,
  id: string,
): Promise<{ threadId: string; message: ChatMessage } | null> {
  const rows = await rowsOf<MessageRow>(db, `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = $1`, [
    id,
  ]);
  const row = rows[0];
  return row ? { threadId: row.thread_id, message: toChatMessage(row) } : null;
}

export async function insertChatMessage(tx: Tx, driverId: string, message: ChatMessage): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO chat_messages (id, thread_id, sender_id, sender_name, sender_role, text, delivery_id, kind, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      message.id,
      driverId,
      message.senderId,
      message.senderName,
      message.senderRole,
      message.text,
      message.deliveryId,
      message.kind,
      new Date(message.createdAt),
    ],
  );
  if (rows.length === 0) return false;
  await publishChange(tx, 'chat_messages', 'created', { ...message, threadId: driverId });
  return true;
}

export async function listChatMessages(
  db: Queryable,
  driverId: string,
  beforeSeq: number | null,
  limit: number,
): Promise<MessageRow[]> {
  return rowsOf<MessageRow>(
    db,
    `SELECT ${MESSAGE_COLUMNS} FROM chat_messages
      WHERE thread_id = $1 AND ($2::bigint IS NULL OR seq < $2::bigint)
      ORDER BY seq DESC LIMIT $3`,
    [driverId, beforeSeq, limit + 1],
  );
}
