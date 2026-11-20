/**
 * Every SQL statement of the store-order module except stock (stock.repository.ts), and the row ↔ document
 * mapping (docs/PLATFORM.md §2.1, §3.1, §3.3). A write of a row that has live topics publishes it through
 * publishChange in the same transaction, so a command cannot forget an event (§8.2).
 */
import type {
  Delivery,
  DeliveryEvent,
  DriverVehicle,
  HoursSchedule,
  StoreOrder,
  StoreOrderPrivateMeta,
  StoreOrderStatus,
} from '@instasupply/shared';
import type { DeliveryRow, StoreOrderRow } from '../../platform/db/locks';
import type { Queryable, Tx } from '../../platform/db/tx';
import { jsonb } from '../../platform/db/json';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable;
type StoreOrderDoc = Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>;
type DeliveryDoc = Omit<Delivery, 'id' | 'createdAt' | 'updatedAt'>;

interface DocRow<D> {
  id: string;
  doc: D;
  created_at: number;
  updated_at: number;
}

/** Never `meta`: the PIN and its attempts stay out of every public shape (§3.3). */
const COLUMNS = 'id, doc, created_at, updated_at';

export const toStoreOrder = (row: DocRow<StoreOrderDoc> | StoreOrderRow): StoreOrder =>
  ({
    ...(row.doc as StoreOrderDoc),
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as StoreOrder;

export const toDelivery = (row: DocRow<DeliveryDoc> | DeliveryRow): Delivery =>
  ({
    ...(row.doc as DeliveryDoc),
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as Delivery;

const toMeta = (meta: Partial<StoreOrderPrivateMeta> | null | undefined): StoreOrderPrivateMeta => ({
  pickupCode: meta?.pickupCode ?? null,
  pickupCodeIssuedTo: meta?.pickupCodeIssuedTo ?? null,
  codeAttempts: meta?.codeAttempts ?? 0,
  commissionBps: meta?.commissionBps ?? 1000,
  alertSmsSentAt: meta?.alertSmsSentAt ?? null,
});

// ---------- store orders ----------

/** For the order writer (placeOrder, acceptQuote, replacements): inserts and publishes a new store order. */
export async function insertStoreOrder(
  tx: Tx,
  order: StoreOrder,
  meta: StoreOrderPrivateMeta,
): Promise<void> {
  const { id, createdAt, updatedAt, ...doc } = order;
  await tx.query(
    `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
    [id, jsonb(doc), jsonb(meta), new Date(createdAt), new Date(updatedAt)],
  );
  await publishChange(tx, 'store_orders', 'created', order);
}

/** The row must be locked by the caller (§3.6). Sets updated_at = tx.now and publishes the change. */
export async function saveStoreOrder(tx: Tx, order: StoreOrder): Promise<StoreOrder> {
  const { id, createdAt: _c, updatedAt: _u, ...doc } = order;
  await tx.query(`UPDATE store_orders SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    id,
    jsonb(doc),
    new Date(tx.now),
  ]);
  const saved = { ...order, updatedAt: tx.now };
  await publishChange(tx, 'store_orders', 'updated', saved);
  return saved;
}

/** Current state inside the caller's transaction (it sees the caller's own writes). */
export async function readStoreOrder(db: Db, id: string): Promise<StoreOrder | null> {
  const { rows } = await db.query<DocRow<StoreOrderDoc>>(
    `SELECT ${COLUMNS} FROM store_orders WHERE id = $1`,
    [id],
  );
  return rows[0] ? toStoreOrder(rows[0]) : null;
}

export interface StoreOrderKeys {
  id: string;
  storeId: string;
  orderId: string;
  customerId: string;
  deliveryId: string | null;
  productIds: string[];
}

/** Rule 3 of §3.6, "keys first": the immutable keys a command needs before it locks. */
export async function loadStoreOrderKeys(db: Db, id: string): Promise<StoreOrderKeys | null> {
  const { rows } = await db.query<{
    id: string;
    store_id: string;
    order_id: string;
    customer_id: string;
    delivery_id: string | null;
    product_ids: string[] | null;
  }>(
    `SELECT id, store_id, order_id, customer_id, delivery_id,
            ARRAY(SELECT l->>'productId' FROM jsonb_array_elements(doc->'lines') l
                   WHERE l->>'kind' = 'catalog' AND l->>'productId' IS NOT NULL) AS product_ids
       FROM store_orders WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    customerId: row.customer_id,
    deliveryId: row.delivery_id,
    productIds: [...new Set(row.product_ids ?? [])],
  };
}

export async function readMeta(db: Db, id: string): Promise<StoreOrderPrivateMeta | null> {
  const { rows } = await db.query<{ meta: Partial<StoreOrderPrivateMeta> }>(
    'SELECT meta FROM store_orders WHERE id = $1',
    [id],
  );
  return rows[0] ? toMeta(rows[0].meta) : null;
}

/** Private columns publish nothing (§8.2) and leave updated_at alone: only staff read them. */
export async function patchMeta(tx: Tx, id: string, patch: Partial<StoreOrderPrivateMeta>): Promise<void> {
  await tx.query('UPDATE store_orders SET meta = meta || $2::jsonb WHERE id = $1', [id, jsonb(patch)]);
}

/** Statuses of every store order of an order, this transaction's writes included. */
export async function orderStoreOrderStatuses(db: Db, orderId: string): Promise<StoreOrderStatus[]> {
  const { rows } = await db.query<{ status: StoreOrderStatus }>(
    'SELECT status FROM store_orders WHERE order_id = $1 ORDER BY id',
    [orderId],
  );
  return rows.map((row) => row.status);
}

export interface StoreOrderStoreInfo {
  alertPhone: string | null;
  schedule: HoursSchedule;
}

/** The store's alert phone (private settings) and its opening hours, for alerts and pickup holds. */
export async function readStoreInfo(db: Db, storeId: string): Promise<StoreOrderStoreInfo> {
  const { rows } = await db.query<{
    alert_phone: string | null;
    hours: HoursSchedule['hours'] | null;
    closures: HoursSchedule['closures'] | null;
  }>(
    `SELECT settings->>'alertPhone' AS alert_phone, doc->'hours' AS hours, doc->'closures' AS closures
       FROM stores WHERE id = $1`,
    [storeId],
  );
  const row = rows[0];
  return {
    alertPhone: row?.alert_phone ?? null,
    schedule: { hours: row?.hours ?? ({} as HoursSchedule['hours']), closures: row?.closures ?? [] },
  };
}

// ---------- the delivery and the offer of a store order ----------

export async function readDelivery(db: Db, id: string): Promise<Delivery | null> {
  const { rows } = await db.query<DocRow<DeliveryDoc>>(`SELECT ${COLUMNS} FROM deliveries WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? toDelivery(rows[0]) : null;
}

export async function deliveryDriverId(db: Db, id: string): Promise<string | null> {
  const { rows } = await db.query<{ driver_id: string | null }>(
    'SELECT driver_id FROM deliveries WHERE id = $1',
    [id],
  );
  return rows[0]?.driver_id ?? null;
}

/** The row must be locked by the caller (lockGraph). Sets updated_at = tx.now and publishes the change. */
export async function saveDelivery(tx: Tx, delivery: Delivery): Promise<Delivery> {
  const { id, createdAt: _c, updatedAt: _u, ...doc } = delivery;
  const saved: Delivery = { ...delivery, updatedAt: tx.now };
  await tx.query('UPDATE deliveries SET doc = $2::jsonb, updated_at = $3 WHERE id = $1', [
    id,
    jsonb({ ...doc }),
    new Date(tx.now),
  ]);
  await publishChange(tx, 'deliveries', 'updated', saved);
  return saved;
}

/** Append-only audit trail (`delivery_events`). */
export async function insertDeliveryEvent(tx: Tx, event: Omit<DeliveryEvent, 'id' | 'at'>): Promise<void> {
  const { deliveryId, ...doc } = event;
  await tx.query('INSERT INTO delivery_events (delivery_id, at, doc) VALUES ($1, $2, $3::jsonb)', [
    deliveryId,
    new Date(tx.now),
    jsonb(doc),
  ]);
  await publishChange(tx, 'delivery_events', 'created', { ...event, at: tx.now });
}

/** `pickup.ready` on the job offer of a delivery, when there is one (the row is locked by lockGraph). */
export async function setOfferPickupReady(tx: Tx, deliveryId: string, ready: boolean): Promise<void> {
  const { rows } = await tx.query<{ delivery_id: string; status: string; audience: string[] }>(
    `UPDATE job_offers SET doc = jsonb_set(doc, '{pickup,ready}', $2::jsonb), updated_at = $3
      WHERE delivery_id = $1 AND (doc #>> '{pickup,ready}')::boolean IS DISTINCT FROM $4
      RETURNING delivery_id, status, audience`,
    [deliveryId, jsonb(ready), new Date(tx.now), ready],
  );
  const row = rows[0];
  if (!row) return;
  await publishChange(tx, 'job_offers', 'updated', {
    deliveryId: row.delivery_id,
    audience: row.audience,
    status: row.status,
    previousStatus: row.status,
  });
}

export async function readDriverCard(
  db: Db,
  uid: string,
): Promise<{ displayName: string; vehicle: DriverVehicle | null } | null> {
  const { rows } = await db.query<{ display_name: string; vehicle: DriverVehicle | null }>(
    `SELECT display_name, doc->'vehicle' AS vehicle FROM users WHERE id = $1`,
    [uid],
  );
  const row = rows[0];
  return row ? { displayName: row.display_name, vehicle: row.vehicle } : null;
}

// ---------- reads of the REST endpoints ----------

export async function findStoreOrder(db: Db, id: string): Promise<StoreOrder | null> {
  return readStoreOrder(db, id);
}

export async function orderCustomerId(db: Db, orderId: string): Promise<string | null> {
  const { rows } = await db.query<{ customer_id: string }>('SELECT customer_id FROM orders WHERE id = $1', [
    orderId,
  ]);
  return rows[0]?.customer_id ?? null;
}

export type StoreOrderSort = 'createdAt:desc' | 'readyBy:asc' | 'completedAt:desc' | 'letter';

export interface StoreOrderFilter {
  orderId?: string;
  storeId?: string;
  customerId?: string;
  statuses?: StoreOrderStatus[];
  acceptOverdue?: boolean;
  readyByDate?: string;
  readyByDateAfter?: string;
  completedSince?: number;
  createdSince?: number;
  sort: StoreOrderSort;
  limit: number;
  /** The decoded cursor: the sort value of the last row and its id. */
  after?: { value: string | number | boolean | null; id: string };
}

interface ListRow extends DocRow<StoreOrderDoc> {
  ready_by: number;
  completed_at: number | null;
}

/** Keyset pages (statement (c) of §3.5) on indexes 8 to 13 of §3.4. Reads `limit + 1` rows. */
export async function listStoreOrders(db: Db, filter: StoreOrderFilter): Promise<ListRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: (n: string) => string, value: unknown): void => {
    values.push(value);
    where.push(sql(`$${values.length}`));
  };
  if (filter.orderId !== undefined) add((p) => `order_id = ${p}`, filter.orderId);
  if (filter.storeId !== undefined) add((p) => `store_id = ${p}`, filter.storeId);
  if (filter.customerId !== undefined) add((p) => `customer_id = ${p}`, filter.customerId);
  if (filter.statuses && filter.statuses.length > 0)
    add((p) => `status = ANY(${p}::text[])`, filter.statuses);
  if (filter.acceptOverdue) where.push('accept_overdue');
  if (filter.readyByDate !== undefined) add((p) => `ready_by_date = ${p}`, filter.readyByDate);
  if (filter.readyByDateAfter !== undefined) add((p) => `ready_by_date > ${p}`, filter.readyByDateAfter);
  if (filter.completedSince !== undefined)
    add((p) => `completed_at >= ${p}`, new Date(filter.completedSince));
  if (filter.createdSince !== undefined) add((p) => `created_at >= ${p}`, new Date(filter.createdSince));

  let order: string;
  const after = filter.after;
  switch (filter.sort) {
    case 'readyBy:asc':
      order = 'ready_by ASC, id ASC';
      if (after) {
        values.push(new Date(Number(after.value)), after.id);
        where.push(`(ready_by, id) > ($${values.length - 1}, $${values.length})`);
      }
      break;
    case 'completedAt:desc':
      where.push('completed_at IS NOT NULL');
      order = 'completed_at DESC, id DESC';
      if (after) {
        values.push(new Date(Number(after.value)), after.id);
        where.push(`(completed_at, id) < ($${values.length - 1}, $${values.length})`);
      }
      break;
    case 'letter':
      order = 'id ASC';
      if (after) add((p) => `id > ${p}`, after.id);
      break;
    case 'createdAt:desc':
      order = 'created_at DESC, id DESC';
      if (after) {
        values.push(new Date(Number(after.value)), after.id);
        where.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
      }
      break;
  }
  values.push(filter.limit + 1);
  const { rows } = await db.query<ListRow>(
    `SELECT ${COLUMNS}, ready_by, completed_at FROM store_orders
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order} LIMIT $${values.length}`,
    values,
  );
  return rows;
}

// ---------- candidates of the scheduled jobs (§9.5) ----------

const MINUTE_MS = 60_000;

/** (1) of escalateStoreOrders: reminder due, not sent, not yet due for the auto-reject. */
export async function reminderCandidates(db: Db, now: number, skip: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM store_orders
      WHERE status = 'new' AND respond_by <= $1 AND respond_by > $2 AND NOT reminder_sent
        AND id <> ALL($3::text[])
      ORDER BY respond_by, id LIMIT 200`,
    [new Date(now + 5 * MINUTE_MS), new Date(now - 20 * MINUTE_MS), [...skip]],
  );
  return rows.map((row) => row.id);
}

/** (2): past respondBy and not flagged yet, not yet due for the auto-reject. */
export async function overdueCandidates(db: Db, now: number, skip: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM store_orders
      WHERE status = 'new' AND respond_by <= $1 AND respond_by > $2 AND NOT accept_overdue
        AND id <> ALL($3::text[])
      ORDER BY respond_by, id LIMIT 200`,
    [new Date(now), new Date(now - 20 * MINUTE_MS), [...skip]],
  );
  return rows.map((row) => row.id);
}

/** (3): no answer 20 minutes after respondBy. */
export async function autoRejectCandidates(db: Db, now: number, skip: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM store_orders
      WHERE status = 'new' AND respond_by <= $1 AND id <> ALL($2::text[])
      ORDER BY respond_by, id LIMIT 200`,
    [new Date(now - 20 * MINUTE_MS), [...skip]],
  );
  return rows.map((row) => row.id);
}

/** expirePickupHolds (index 12). */
export async function expiredHoldCandidates(db: Db, now: number, skip: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM store_orders
      WHERE fulfilment = 'pickup' AND status = 'ready' AND hold_until <= $1 AND id <> ALL($2::text[])
      ORDER BY hold_until, id LIMIT 200`,
    [new Date(now), [...skip]],
  );
  return rows.map((row) => row.id);
}

/** The product ids of a store order's catalog lines, for the product locks of a job's transaction. */
export async function storeOrderProductIds(db: Db, id: string): Promise<string[]> {
  return (await loadStoreOrderKeys(db, id))?.productIds ?? [];
}
