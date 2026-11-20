/**
 * SQL of customer and store support (docs/PLATFORM.md §3.3, MARKETPLACE D11): `support_threads` and
 * `support_messages`, typed columns only. A thread's id is the customer's uid or `store_{storeId}`; a message's
 * id is the client's UUIDv4. `seq` orders messages and never leaves the server.
 */
import type {
  SupportContext,
  SupportMessage,
  SupportSenderRole,
  SupportThread,
  SupportThreadKind,
  WithId,
} from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable | Tx;
async function rowsOf<R>(db: Db, text: string, values: unknown[]): Promise<R[]> {
  return (await (db as Tx).query<R>(text, values)).rows;
}

// ---------- threads ----------

interface ThreadRow {
  id: string;
  kind: SupportThreadKind;
  owner_id: string;
  owner_name: string;
  company_name: string | null;
  status: 'open' | 'resolved';
  assigned_to: string | null;
  assigned_name: string | null;
  context: SupportContext | null;
  last_message: SupportThread['lastMessage'];
  unread_by_owner: number;
  unread_by_staff: number;
  owner_read_at: number | null;
  staff_read_at: number | null;
  created_at: number;
  updated_at: number;
}

const THREAD_COLUMNS = `id, kind, owner_id, owner_name, company_name, status, assigned_to, assigned_name, context,
  last_message, unread_by_owner, unread_by_staff, owner_read_at, staff_read_at, created_at, updated_at`;

export const toSupportThread = (row: ThreadRow): WithId<SupportThread> => ({
  id: row.id,
  kind: row.kind,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  companyName: row.company_name,
  status: row.status,
  assignedTo: row.assigned_to,
  assignedName: row.assigned_name,
  context: row.context,
  lastMessage: row.last_message,
  unreadByOwner: row.unread_by_owner,
  unreadByStaff: row.unread_by_staff,
  ownerReadAt: row.owner_read_at,
  staffReadAt: row.staff_read_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const threadCursorKey = (row: ThreadRow): [number, string] => [row.updated_at, row.id];

export async function findThread(db: Db, id: string): Promise<WithId<SupportThread> | null> {
  const rows = await rowsOf<ThreadRow>(db, `SELECT ${THREAD_COLUMNS} FROM support_threads WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? toSupportThread(rows[0]) : null;
}

/** Rank 11 of §3.6. */
export async function lockThread(tx: Tx, id: string): Promise<WithId<SupportThread> | null> {
  const rows = await rowsOf<ThreadRow>(
    tx,
    `SELECT ${THREAD_COLUMNS} FROM support_threads WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ? toSupportThread(rows[0]) : null;
}

/** The thread is created on its first message (`ON CONFLICT DO NOTHING`, then the caller locks it). */
export async function ensureThread(
  tx: Tx,
  thread: {
    id: string;
    kind: SupportThreadKind;
    ownerId: string;
    ownerName: string;
    companyName: string | null;
  },
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO support_threads (id, kind, owner_id, owner_name, company_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      thread.id,
      thread.kind,
      thread.ownerId,
      thread.ownerName.slice(0, 80),
      thread.companyName,
      new Date(tx.now),
    ],
  );
  return rows.length > 0;
}

/** The summary after a message: last message, the other side's unread counter, context, status. */
export async function applyMessageToThread(
  tx: Tx,
  id: string,
  input: {
    lastMessage: NonNullable<SupportThread['lastMessage']>;
    inbound: boolean;
    context: SupportContext | null;
    reopen: boolean;
  },
): Promise<void> {
  await tx.query(
    `UPDATE support_threads SET
       last_message = $2::jsonb,
       unread_by_staff = unread_by_staff + CASE WHEN $3::boolean THEN 1 ELSE 0 END,
       unread_by_owner = unread_by_owner + CASE WHEN $3::boolean THEN 0 ELSE 1 END,
       context = COALESCE($4::jsonb, context),
       status = CASE WHEN $5::boolean THEN 'open' ELSE status END,
       updated_at = $6
     WHERE id = $1`,
    [
      id,
      JSON.stringify(input.lastMessage),
      input.inbound,
      input.context === null ? null : JSON.stringify(input.context),
      input.reopen,
      new Date(tx.now),
    ],
  );
  await publishChange(tx, 'support_threads', 'updated', { id });
}

/** Resets one side's unread counter. */
export async function markThreadRead(tx: Tx, id: string, side: 'owner' | 'staff'): Promise<boolean> {
  const sql =
    side === 'owner'
      ? `UPDATE support_threads SET unread_by_owner = 0, owner_read_at = $2 WHERE id = $1`
      : `UPDATE support_threads SET unread_by_staff = 0, staff_read_at = $2 WHERE id = $1`;
  const { rowCount } = await tx.query(sql, [id, new Date(tx.now)]);
  if (rowCount > 0) await publishChange(tx, 'support_threads', 'updated', { id });
  return rowCount > 0;
}

export async function patchThread(
  tx: Tx,
  id: string,
  patch: { status?: 'open' | 'resolved'; assigned?: { to: string | null; name: string | null } },
): Promise<void> {
  await tx.query(
    `UPDATE support_threads SET
       status = COALESCE($2, status),
       assigned_to = CASE WHEN $3::boolean THEN $4 ELSE assigned_to END,
       assigned_name = CASE WHEN $3::boolean THEN $5 ELSE assigned_name END,
       updated_at = $6
     WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.assigned !== undefined,
      patch.assigned?.to ?? null,
      patch.assigned?.name ?? null,
      new Date(tx.now),
    ],
  );
  await publishChange(tx, 'support_threads', 'updated', { id });
}

export interface ThreadFilter {
  kind: SupportThreadKind | null;
  status: 'open' | 'resolved' | null;
  unread: boolean;
}

/** GET /support-threads: most recently updated first (indexes 29, 30). */
export async function listThreads(
  db: Queryable,
  filter: ThreadFilter,
  after: [number, string] | null,
  limit: number,
): Promise<ThreadRow[]> {
  return rowsOf<ThreadRow>(
    db,
    `SELECT ${THREAD_COLUMNS} FROM support_threads
      WHERE ($1::text IS NULL OR kind = $1)
        AND ($2::text IS NULL OR status = $2)
        AND (NOT $3::boolean OR unread_by_staff > 0)
        AND ($4::timestamptz IS NULL OR (updated_at, id) < ($4::timestamptz, $5::text))
      ORDER BY updated_at DESC, id DESC
      LIMIT $6`,
    [
      filter.kind,
      filter.status,
      filter.unread,
      after ? new Date(after[0]) : null,
      after ? after[1] : null,
      limit + 1,
    ],
  );
}

// ---------- owners and staff ----------

export interface ThreadOwner {
  kind: SupportThreadKind;
  ownerId: string;
  ownerName: string;
  companyName: string | null;
}

/** Who a thread id belongs to: an existing customer, or an existing store (`store_{storeId}`). */
export async function resolveOwner(db: Db, threadId: string): Promise<ThreadOwner | null> {
  if (threadId.startsWith('store_')) {
    const storeId = threadId.slice('store_'.length);
    const rows = await rowsOf<{ name: string }>(db, `SELECT doc->>'name' AS name FROM stores WHERE id = $1`, [
      storeId,
    ]);
    const row = rows[0];
    return row ? { kind: 'store', ownerId: storeId, ownerName: row.name, companyName: null } : null;
  }
  const rows = await rowsOf<{ name: string; company: string | null }>(
    db,
    `SELECT display_name AS name, doc->>'companyName' AS company FROM users WHERE id = $1 AND role = 'customer'`,
    [threadId],
  );
  const row = rows[0];
  return row
    ? { kind: 'customer', ownerId: threadId, ownerName: row.name || 'Customer', companyName: row.company }
    : null;
}

/** `assignedTo` must be an active staff uid; answers the name to store with it. */
export async function activeStaffName(db: Db, uid: string): Promise<string | null> {
  const rows = await rowsOf<{ name: string }>(
    db,
    `SELECT display_name AS name FROM users WHERE id = $1 AND role IN ('admin', 'dispatcher') AND status = 'active'`,
    [uid],
  );
  return rows[0] ? rows[0].name || 'Staff' : null;
}

// ---------- messages ----------

interface MessageRow {
  id: string;
  thread_id: string;
  seq: number;
  sender_id: string;
  sender_name: string;
  sender_role: SupportSenderRole;
  text: string;
  context: SupportContext | null;
  created_at: number;
}

const MESSAGE_COLUMNS = 'id, thread_id, seq, sender_id, sender_name, sender_role, text, context, created_at';

export const toSupportMessage = (row: MessageRow): SupportMessage => ({
  id: row.id,
  text: row.text,
  senderId: row.sender_id,
  senderName: row.sender_name,
  senderRole: row.sender_role,
  context: row.context,
  createdAt: row.created_at,
});

export const messageCursorKey = (row: MessageRow): [number, string] => [row.seq, row.id];

export interface StoredMessage {
  threadId: string;
  message: SupportMessage;
}

export async function findMessage(db: Db, id: string): Promise<StoredMessage | null> {
  const rows = await rowsOf<MessageRow>(db, `SELECT ${MESSAGE_COLUMNS} FROM support_messages WHERE id = $1`, [
    id,
  ]);
  const row = rows[0];
  return row ? { threadId: row.thread_id, message: toSupportMessage(row) } : null;
}

/** `ON CONFLICT (id) DO NOTHING`: a repeated id returns null and the caller answers the stored message. */
export async function insertMessage(tx: Tx, threadId: string, message: SupportMessage): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO support_messages (id, thread_id, sender_id, sender_name, sender_role, text, context, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      message.id,
      threadId,
      message.senderId,
      message.senderName,
      message.senderRole,
      message.text,
      message.context === null ? null : JSON.stringify(message.context),
      new Date(message.createdAt),
    ],
  );
  if (rows.length === 0) return false;
  await publishChange(tx, 'support_messages', 'created', { ...message, threadId });
  return true;
}

/** The newest `limit` messages before the cursor, newest first (the route reverses them). */
export async function listMessages(
  db: Queryable,
  threadId: string,
  beforeSeq: number | null,
  limit: number,
): Promise<MessageRow[]> {
  return rowsOf<MessageRow>(
    db,
    `SELECT ${MESSAGE_COLUMNS} FROM support_messages
      WHERE thread_id = $1 AND ($2::bigint IS NULL OR seq < $2::bigint)
      ORDER BY seq DESC LIMIT $3`,
    [threadId, beforeSeq, limit + 1],
  );
}
