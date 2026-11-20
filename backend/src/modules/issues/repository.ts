/**
 * Every SQL statement of the issues module (docs/PLATFORM.md §2.1, §3.2 `issues`, §3.3, §3.5, §9.2.11): the issue
 * rows and their private notes, the store-order columns an issue changes (`issueCount`, a credit before capture),
 * the ledger holds (index `ledger_held_idx`), and the refunds still waiting in the outbox. Each write announces
 * itself with publishChange.
 */
import type { Issue, IssueNotes, IssueStatus, Order, StoreOrder } from '@instasupply/shared';
import { jsonb } from '../../platform/db/json';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

// ---------- issues ----------

type IssueDoc = Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>;
interface IssueDbRow {
  id: string;
  doc: IssueDoc;
  created_at: number;
  updated_at: number;
}
const ISSUE_COLUMNS = 'id, doc, created_at, updated_at';

const toIssue = (row: IssueDbRow): Issue => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const splitIssue = (issue: Issue): IssueDoc => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...doc } = issue;
  return doc;
};

const announce = (tx: Tx, kind: 'created' | 'updated', issue: Issue) =>
  publishChange(tx, 'issues', kind, { id: issue.id, customerId: issue.customerId, storeId: issue.storeId });

export async function findIssue(db: Queryable, id: string): Promise<Issue | null> {
  const { rows } = await db.query<IssueDbRow>(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE id = $1`, [id]);
  return rows[0] ? toIssue(rows[0]) : null;
}

/** Rank 3 of §3.6; the caller holds users(customer) first when it writes the order too. */
export async function lockIssue(tx: Tx, id: string): Promise<Issue | null> {
  const { rows } = await tx.query<IssueDbRow>(
    `SELECT ${ISSUE_COLUMNS} FROM issues WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ? toIssue(rows[0]) : null;
}

/**
 * Inserts a new issue. False when the id exists already or the store order has an open issue (a unique
 * violation of the primary key or of `issues_open_key`, answered without aborting the transaction).
 */
export async function insertIssue(tx: Tx, issue: Issue): Promise<boolean> {
  const { rowCount } = await tx.query(
    `INSERT INTO issues (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4) ON CONFLICT DO NOTHING`,
    [issue.id, jsonb(splitIssue(issue)), new Date(issue.createdAt), new Date(issue.updatedAt)],
  );
  if (rowCount === 0) return false;
  await announce(tx, 'created', issue);
  return true;
}

/** The row must be locked by the caller. Sets updated_at = tx.now. */
export async function saveIssue(tx: Tx, issue: Issue): Promise<Issue> {
  const saved: Issue = { ...issue, updatedAt: tx.now };
  await tx.query(`UPDATE issues SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    issue.id,
    jsonb(splitIssue(saved)),
    new Date(tx.now),
  ]);
  await announce(tx, 'updated', saved);
  return saved;
}

export async function openIssueOf(db: Queryable, storeOrderId: string): Promise<Issue | null> {
  const { rows } = await db.query<IssueDbRow>(
    `SELECT ${ISSUE_COLUMNS} FROM issues WHERE store_order_id = $1 AND status <> 'resolved'`,
    [storeOrderId],
  );
  return rows[0] ? toIssue(rows[0]) : null;
}

/** The refunds already granted on a store order (its resolved refund issues), for refundForLines. */
export async function resolvedRefundsOf(
  db: Queryable,
  storeOrderId: string,
): Promise<{ lines: { lineId: string; quantity: number }[]; includeDeliveryFee: boolean }[]> {
  const { rows } = await db.query<IssueDbRow>(
    `SELECT ${ISSUE_COLUMNS} FROM issues
      WHERE store_order_id = $1 AND status = 'resolved' AND doc #>> '{resolution,kind}' = 'refund'
      ORDER BY created_at, id`,
    [storeOrderId],
  );
  return rows.map(toIssue).map((issue) => ({
    lines: issue.lines.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
    includeDeliveryFee: issue.resolution?.refundDeliveryFee ?? false,
  }));
}

export interface IssueFilter {
  customerId?: string;
  storeId?: string;
  orderId?: string;
  storeOrderId?: string;
  statuses?: IssueStatus[];
  limit: number;
  after: { createdAt: number; id: string } | null;
}

/** Keyset page (§4.4) over indexes 26 to 28, newest first: `limit + 1` rows. */
export async function listIssues(db: Queryable, filter: IssueFilter): Promise<Issue[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: (n: string) => string, value: unknown) => {
    values.push(value);
    where.push(clause(`$${values.length}`));
  };
  if (filter.customerId !== undefined) add((n) => `customer_id = ${n}`, filter.customerId);
  if (filter.storeId !== undefined) add((n) => `store_id = ${n}`, filter.storeId);
  if (filter.orderId !== undefined) add((n) => `order_id = ${n}`, filter.orderId);
  if (filter.storeOrderId !== undefined) add((n) => `store_order_id = ${n}`, filter.storeOrderId);
  if (filter.statuses !== undefined) add((n) => `status = ANY(${n}::text[])`, filter.statuses);
  if (filter.after) {
    values.push(new Date(filter.after.createdAt), filter.after.id);
    where.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(filter.limit + 1);
  const { rows } = await db.query<IssueDbRow>(
    `SELECT ${ISSUE_COLUMNS} FROM issues ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map(toIssue);
}

// ---------- private notes ----------

export async function readNotes(db: Queryable, id: string): Promise<IssueNotes | null> {
  const { rows } = await db.query<{ notes: IssueNotes | null }>('SELECT notes FROM issues WHERE id = $1', [
    id,
  ]);
  return rows[0]?.notes ?? null;
}

/** Nothing is published: no topic covers the notes. False when the issue is gone. */
export async function writeNotes(db: Queryable, id: string, notes: IssueNotes): Promise<boolean> {
  const { rowCount } = await db.query('UPDATE issues SET notes = $2::jsonb WHERE id = $1', [
    id,
    jsonb(notes),
  ]);
  return (rowCount ?? 0) > 0;
}

// ---------- store orders, orders, deliveries ----------

type StoreOrderDoc = Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>;
interface StoreOrderDbRow {
  id: string;
  doc: StoreOrderDoc;
  commission_bps: number | null;
  created_at: number;
  updated_at: number;
}

const toStoreOrder = (row: StoreOrderDbRow): StoreOrder => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The store order with the commission rate of its private meta (never the PIN). */
export async function readStoreOrder(
  db: Queryable,
  id: string,
): Promise<{ storeOrder: StoreOrder; commissionBps: number } | null> {
  const { rows } = await db.query<StoreOrderDbRow>(
    `SELECT id, doc, (meta->>'commissionBps')::int AS commission_bps, created_at, updated_at
       FROM store_orders WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { storeOrder: toStoreOrder(row), commissionBps: row.commission_bps ?? 1000 } : null;
}

/** The row must be locked by the caller (lockGraph). Sets updated_at = tx.now and publishes. */
export async function saveStoreOrderDoc(tx: Tx, storeOrder: StoreOrder): Promise<StoreOrder> {
  const { id, createdAt: _c, updatedAt: _u, ...doc } = storeOrder;
  await tx.query('UPDATE store_orders SET doc = $2::jsonb, updated_at = $3 WHERE id = $1', [
    id,
    jsonb(doc),
    new Date(tx.now),
  ]);
  const saved = { ...storeOrder, updatedAt: tx.now };
  await publishChange(tx, 'store_orders', 'updated', saved);
  return saved;
}

export async function readOrder(db: Queryable, id: string): Promise<Order | null> {
  const { rows } = await db.query<{
    id: string;
    doc: Omit<Order, 'id'>;
    created_at: number;
    updated_at: number;
  }>('SELECT id, doc, created_at, updated_at FROM orders WHERE id = $1', [id]);
  const row = rows[0];
  return row
    ? ({ ...row.doc, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at } as Order)
    : null;
}

export async function deliveryDriverId(db: Queryable, deliveryId: string): Promise<string | null> {
  const { rows } = await db.query<{ driver_id: string | null }>(
    'SELECT driver_id FROM deliveries WHERE id = $1',
    [deliveryId],
  );
  return rows[0]?.driver_id ?? null;
}

/** Catalogue prices: a replacement pays the store the catalogue price (MARKETPLACE §3.6, §3.9). */
export async function catalogPrices(db: Queryable, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; price_cents: number }>(
    'SELECT id, price_cents FROM products WHERE id = ANY($1::text[])',
    [[...ids]],
  );
  return new Map(rows.map((row) => [row.id, row.price_cents]));
}

// ---------- the outbox: refunds not booked yet ----------

/** Σ amountCents of `payment.refund` rows still pending or processing for an order: per store order, and all. */
export async function pendingRefunds(
  tx: Tx,
  orderId: string,
): Promise<{ total: number; issueRefundsByStoreOrder: Map<string, number> }> {
  const { rows } = await tx.query<{ store_order_id: string; automatic: boolean; cents: number }>(
    `SELECT payload->>'storeOrderId' AS store_order_id,
            (payload->>'idempotencyKey' LIKE 'refund\\_adj\\_%') AS automatic,
            COALESCE(sum((payload->>'amountCents')::bigint), 0)::bigint AS cents
       FROM outbox
      WHERE event = 'payment.refund' AND status IN ('pending', 'processing') AND payload->>'orderId' = $1
      GROUP BY 1, 2`,
    [orderId],
  );
  let total = 0;
  const issueRefundsByStoreOrder = new Map<string, number>();
  for (const row of rows) {
    total += row.cents;
    if (!row.automatic) {
      issueRefundsByStoreOrder.set(
        row.store_order_id,
        (issueRefundsByStoreOrder.get(row.store_order_id) ?? 0) + row.cents,
      );
    }
  }
  return { total, issueRefundsByStoreOrder };
}

// ---------- ledger holds (MARKETPLACE §3.9, index ledger_held_idx) ----------

interface HeldRow {
  id: string;
  payee_type: 'store' | 'driver';
  payee_id: string;
}

async function announceLedger(tx: Tx, rows: HeldRow[]): Promise<void> {
  for (const row of rows) {
    await publishChange(tx, 'ledger_entries', 'updated', {
      id: row.id,
      payeeType: row.payee_type,
      payeeId: row.payee_id,
    });
  }
}

/** While the issue is open, the store's unpaid entries of the store order are skipped by payouts. */
export async function holdStoreLedger(tx: Tx, issueId: string, storeOrderId: string): Promise<void> {
  const { rows } = await tx.query<HeldRow>(
    `UPDATE ledger_entries SET held_for_issue_id = $1
      WHERE store_order_id = $2 AND payee_type = 'store' AND payout_id IS NULL
      RETURNING id, payee_type, payee_id`,
    [issueId, storeOrderId],
  );
  await announceLedger(tx, rows);
}

export async function releaseLedgerHolds(tx: Tx, issueId: string): Promise<void> {
  const { rows } = await tx.query<HeldRow>(
    `UPDATE ledger_entries SET held_for_issue_id = NULL WHERE held_for_issue_id = $1
      RETURNING id, payee_type, payee_id`,
    [issueId],
  );
  await announceLedger(tx, rows);
}

/** Active staff (assignee check of PATCH /issues). */
export async function activeStaffName(db: Queryable, uid: string): Promise<string | null> {
  const { rows } = await db.query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1 AND role IN ('admin', 'dispatcher') AND status = 'active'`,
    [uid],
  );
  return rows[0]?.display_name ?? null;
}
