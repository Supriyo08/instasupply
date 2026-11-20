/**
 * Every SQL statement of the payments module (docs/PLATFORM.md §3.2, §10.4): the authorization journal
 * (`payment_authorizations`, rank 15, nothing references it) and `orders.doc.payment`, which only this module
 * writes (MARKETPLACE §5.10 "single writers").
 */
import type { CardBrand, Order, OrderPayment, StoreOrder } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

export type JournalStatus =
  'pending' | 'authorized' | 'declined' | 'attached' | 'void_pending' | 'voided' | 'captured';

export interface JournalCard {
  cardId: string;
  brand: CardBrand;
  last4: string;
}

export interface JournalRow {
  order_id: string;
  customer_id: string;
  amount_cents: number;
  card: JournalCard;
  provider: 'test' | 'stripe';
  status: JournalStatus;
  attempt: number;
  intent_ref: string | null;
  capture_before: number | null;
  decline_reason: string | null;
  capture_breakdown: Record<string, number> | null;
  created_at: number;
  updated_at: number;
}

const JOURNAL_COLUMNS = `order_id, customer_id, amount_cents, card, provider, status, attempt, intent_ref, capture_before,
  decline_reason, capture_breakdown, created_at, updated_at`;

/** Creates the journal row as `pending` attempt 1 unless one exists (§9.2.1 step 4). */
export async function insertJournal(
  db: Queryable,
  input: {
    orderId: string;
    customerId: string;
    amountCents: number;
    card: JournalCard;
    provider: 'test' | 'stripe';
    now: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO payment_authorizations (order_id, customer_id, amount_cents, card, provider, status, attempt, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'pending', 1, $6, $6)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      input.orderId,
      input.customerId,
      input.amountCents,
      JSON.stringify(input.card),
      input.provider,
      new Date(input.now),
    ],
  );
}

export async function readJournal(db: Queryable, orderId: string): Promise<JournalRow | null> {
  const { rows } = await db.query<JournalRow>(
    `SELECT ${JOURNAL_COLUMNS} FROM payment_authorizations WHERE order_id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

export async function lockJournal(tx: Tx, orderId: string): Promise<JournalRow | null> {
  const { rows } = await tx.query<JournalRow>(
    `SELECT ${JOURNAL_COLUMNS} FROM payment_authorizations WHERE order_id = $1 FOR NO KEY UPDATE`,
    [orderId],
  );
  return rows[0] ?? null;
}

export async function updateJournal(
  tx: Tx,
  orderId: string,
  patch: Partial<{
    status: JournalStatus;
    attempt: number;
    amountCents: number;
    card: JournalCard;
    intentRef: string | null;
    captureBefore: number | null;
    declineReason: string | null;
    captureBreakdown: Record<string, number> | null;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [orderId];
  const set = (column: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.attempt !== undefined) set('attempt', patch.attempt);
  if (patch.amountCents !== undefined) set('amount_cents', patch.amountCents);
  if (patch.card !== undefined) set('card', JSON.stringify(patch.card), '::jsonb');
  if (patch.intentRef !== undefined) set('intent_ref', patch.intentRef);
  if (patch.captureBefore !== undefined) {
    set('capture_before', patch.captureBefore === null ? null : new Date(patch.captureBefore));
  }
  if (patch.declineReason !== undefined) set('decline_reason', patch.declineReason);
  if (patch.captureBreakdown !== undefined) {
    set(
      'capture_breakdown',
      patch.captureBreakdown === null ? null : JSON.stringify(patch.captureBreakdown),
      '::jsonb',
    );
  }
  set('updated_at', new Date(tx.now));
  await tx.query(`UPDATE payment_authorizations SET ${sets.join(', ')} WHERE order_id = $1`, params);
}

export async function orderExists(db: Queryable, orderId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM orders WHERE id = $1', [orderId]);
  return rows.length > 0;
}

/** Candidates of `captureDuePayments` (4): journal rows still open, older than `before`, with no order. */
export async function orphanJournals(
  db: Queryable,
  before: number,
  afterId: string | null,
): Promise<string[]> {
  const { rows } = await db.query<{ order_id: string }>(
    `SELECT j.order_id FROM payment_authorizations j
      WHERE j.status IN ('pending', 'authorized', 'void_pending') AND j.updated_at < $1
        AND ($2::text IS NULL OR j.order_id > $2)
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = j.order_id)
      ORDER BY j.order_id LIMIT 200`,
    [new Date(before), afterId],
  );
  return rows.map((row) => row.order_id);
}

// ---------- orders.payment ----------

interface OrderDbRow {
  id: string;
  doc: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>;
  created_at: number;
  updated_at: number;
}

const toOrder = (row: OrderDbRow): Order => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function readOrder(db: Queryable, orderId: string): Promise<Order | null> {
  const { rows } = await db.query<OrderDbRow>(
    'SELECT id, doc, created_at, updated_at FROM orders WHERE id = $1',
    [orderId],
  );
  return rows[0] ? toOrder(rows[0]) : null;
}

/**
 * Locks users(customer) then the order (ranks 1 and 4 of §3.6): every transaction that writes an order holds
 * its customer's row (R4).
 */
export async function lockOrder(tx: Tx, orderId: string): Promise<Order | null> {
  const { rows: keys } = await tx.query<{ customer_id: string }>(
    'SELECT customer_id FROM orders WHERE id = $1',
    [orderId],
  );
  const customerId = keys[0]?.customer_id;
  if (!customerId) return null;
  await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [customerId]);
  const { rows } = await tx.query<OrderDbRow>(
    'SELECT id, doc, created_at, updated_at FROM orders WHERE id = $1 FOR NO KEY UPDATE',
    [orderId],
  );
  return rows[0] ? toOrder(rows[0]) : null;
}

/** Writes `doc.payment` only; the rest of the order belongs to the aggregate. */
export async function savePayment(tx: Tx, order: Order, payment: OrderPayment): Promise<Order> {
  await tx.query(
    `UPDATE orders SET doc = jsonb_set(doc, '{payment}', $2::jsonb), updated_at = $3 WHERE id = $1`,
    [order.id, JSON.stringify(payment), new Date(tx.now)],
  );
  await publishChange(tx, 'orders', 'updated', { id: order.id, customerId: order.customerId });
  return { ...order, payment, updatedAt: tx.now };
}

export async function storeOrdersOf(db: Queryable, orderId: string): Promise<StoreOrder[]> {
  const { rows } = await db.query<{
    id: string;
    doc: Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>;
    created_at: number;
    updated_at: number;
  }>(`SELECT id, doc, created_at, updated_at FROM store_orders WHERE order_id = $1 ORDER BY id COLLATE "C"`, [
    orderId,
  ]);
  return rows.map((row) => ({
    ...row.doc,
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Candidates of `captureDuePayments` (1) to (3). */
export async function dueOrders(
  db: Queryable,
  kind: 'capture_failed' | 'capture_pending' | 'deadline',
  now: number,
  afterId: string | null,
): Promise<string[]> {
  const condition =
    kind === 'capture_failed'
      ? `payment_status = 'capture_failed' AND $1::timestamptz IS NOT NULL`
      : kind === 'capture_pending'
        ? `payment_status = 'capture_pending' AND updated_at < $1`
        : `payment_status = 'authorized' AND capture_deadline_at <= $1`;
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM orders WHERE ${condition} AND ($2::text IS NULL OR id > $2) ORDER BY id LIMIT 200`,
    [new Date(kind === 'capture_pending' ? now - 10 * 60_000 : now), afterId],
  );
  return rows.map((row) => row.id);
}
