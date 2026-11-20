/**
 * Every SQL statement of the commerce module (docs/PLATFORM.md §3.1 repository shape, §3.3, §3.5): orders, the
 * inserts of new store orders, the customer columns a checkout reads and writes, and the plain reads that
 * build a checkout (stores with their settings, products). Each write announces itself with publishChange.
 */
import type {
  CardBrand,
  JobsiteFields,
  Order,
  OrderStatus,
  Product,
  Store,
  StoreOrder,
  StorePrivateSettings,
  UserProfile,
} from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

// ---------- orders ----------

export type OrderDoc = Omit<Order, 'id' | 'createdAt' | 'updatedAt'>;
interface OrderDbRow {
  id: string;
  doc: OrderDoc;
  created_at: number;
  updated_at: number;
}
const ORDER_COLUMNS = 'id, doc, created_at, updated_at';

export const toOrder = (row: OrderDbRow): Order => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const splitOrder = (order: Order): OrderDoc => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...doc } = order;
  return doc;
};

export async function findOrder(db: Queryable, id: string): Promise<Order | null> {
  const { rows } = await db.query<OrderDbRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function findOrderCustomer(db: Queryable, id: string): Promise<string | null> {
  const { rows } = await db.query<{ customer_id: string }>('SELECT customer_id FROM orders WHERE id = $1', [
    id,
  ]);
  return rows[0]?.customer_id ?? null;
}

export async function insertOrder(tx: Tx, order: Order): Promise<void> {
  await tx.query(`INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)`, [
    order.id,
    JSON.stringify(splitOrder(order)),
    new Date(order.createdAt),
    new Date(order.updatedAt),
  ]);
  await publishChange(tx, 'orders', 'created', { id: order.id, customerId: order.customerId });
}

/** The row must be locked by the caller (§3.6). Sets updated_at = tx.now. */
export async function saveOrder(tx: Tx, order: Order): Promise<Order> {
  await tx.query(`UPDATE orders SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    order.id,
    JSON.stringify(splitOrder(order)),
    new Date(tx.now),
  ]);
  await publishChange(tx, 'orders', 'updated', { id: order.id, customerId: order.customerId });
  return { ...order, updatedAt: tx.now };
}

export interface OrderFilters {
  customerId?: string;
  statuses?: OrderStatus[];
  jobsiteId?: string;
  storeId?: string;
  needsAttention?: boolean;
  paymentStatuses?: string[];
  createdSince?: number;
  createdUntil?: number;
}

/** Keyset page, newest first (statement (c) of §3.5); `limit + 1` rows. */
export async function listOrders(
  db: Queryable,
  filters: OrderFilters,
  limit: number,
  after: { createdAt: number; id: string } | null,
): Promise<Order[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (filters.customerId !== undefined) add((n) => `customer_id = ${n}`, filters.customerId);
  if (filters.statuses?.length) add((n) => `status = ANY(${n}::text[])`, filters.statuses);
  if (filters.jobsiteId !== undefined) add((n) => `jobsite_id = ${n}`, filters.jobsiteId);
  if (filters.needsAttention) where.push('needs_attention');
  if (filters.paymentStatuses?.length)
    add((n) => `payment_status = ANY(${n}::text[])`, filters.paymentStatuses);
  if (filters.createdSince !== undefined) add((n) => `created_at >= ${n}`, new Date(filters.createdSince));
  if (filters.createdUntil !== undefined) add((n) => `created_at < ${n}`, new Date(filters.createdUntil));
  if (filters.storeId !== undefined) {
    add(
      (n) => `EXISTS (SELECT 1 FROM store_orders so WHERE so.order_id = orders.id AND so.store_id = ${n})`,
      filters.storeId,
    );
  }
  if (after) {
    params.push(new Date(after.createdAt), after.id);
    where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
  }
  params.push(limit + 1);
  const { rows } = await db.query<OrderDbRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toOrder);
}

// ---------- store orders ----------

type StoreOrderDoc = Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>;
interface StoreOrderDbRow {
  id: string;
  doc: StoreOrderDoc;
  created_at: number;
  updated_at: number;
}

export const toStoreOrder = (row: StoreOrderDbRow): StoreOrder => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Siblings are read without a lock: the caller holds users(customer) and the order (rule 1 of §3.6). */
export async function listStoreOrdersOfOrder(db: Queryable, orderId: string): Promise<StoreOrder[]> {
  const { rows } = await db.query<StoreOrderDbRow>(
    `SELECT id, doc, created_at, updated_at FROM store_orders WHERE order_id = $1 ORDER BY id COLLATE "C"`,
    [orderId],
  );
  return rows.map(toStoreOrder);
}

export async function readStoreOrder(db: Queryable, id: string): Promise<StoreOrder | null> {
  const { rows } = await db.query<StoreOrderDbRow>(
    'SELECT id, doc, created_at, updated_at FROM store_orders WHERE id = $1',
    [id],
  );
  return rows[0] ? toStoreOrder(rows[0]) : null;
}

export async function readPickupCode(db: Queryable, storeOrderId: string): Promise<string | null> {
  const { rows } = await db.query<{ code: string | null }>(
    `SELECT meta->>'pickupCode' AS code FROM store_orders WHERE id = $1`,
    [storeOrderId],
  );
  return rows[0]?.code ?? null;
}

export async function readTrackingToken(db: Queryable, deliveryId: string): Promise<string | null> {
  const { rows } = await db.query<{ token: string }>(
    'SELECT tracking_token AS token FROM deliveries WHERE id = $1',
    [deliveryId],
  );
  return rows[0]?.token ?? null;
}

// ---------- the customer ----------

/** The customer columns a checkout reads (`doc` keys of §3.3). */
export interface CustomerRecord {
  id: string;
  role: string | null;
  status: string;
  displayName: string;
  phoneNumber: string | null;
  phoneVerified: boolean;
  doc: Pick<UserProfile, 'companyName' | 'accountType' | 'stats' | 'promoUses' | 'preferences'> &
    Record<string, unknown>;
}

interface CustomerDbRow {
  id: string;
  role: string | null;
  status: string;
  display_name: string;
  phone_number: string | null;
  phone_verified: boolean;
  doc: CustomerRecord['doc'];
}

const toCustomer = (row: CustomerDbRow): CustomerRecord => ({
  id: row.id,
  role: row.role,
  status: row.status,
  displayName: row.display_name,
  phoneNumber: row.phone_number,
  phoneVerified: row.phone_verified,
  doc: row.doc ?? {},
});

const CUSTOMER_COLUMNS = 'id, role, status, display_name, phone_number, phone_verified, doc';

export async function readCustomer(db: Queryable, id: string): Promise<CustomerRecord | null> {
  const { rows } = await db.query<CustomerDbRow>(`SELECT ${CUSTOMER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toCustomer(rows[0]) : null;
}

/** Rank 1 of §3.6: the root lock of every order of this customer (R4). */
export async function lockCustomer(tx: Tx, id: string): Promise<CustomerRecord | null> {
  const { rows } = await tx.query<CustomerDbRow>(
    `SELECT ${CUSTOMER_COLUMNS} FROM users WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ? toCustomer(rows[0]) : null;
}

/** Merges top-level `doc` keys of a locked user and announces the change on user:{uid}. */
export async function patchCustomerDoc(
  tx: Tx,
  customer: CustomerRecord,
  patch: Record<string, unknown>,
): Promise<void> {
  await tx.query(`UPDATE users SET doc = doc || $2::jsonb, updated_at = $3 WHERE id = $1`, [
    customer.id,
    JSON.stringify(patch),
    new Date(tx.now),
  ]);
  await publishChange(tx, 'users', 'updated', { uid: customer.id, role: customer.role });
}

/** registerCustomer (§6.3.2): the role, the status, the name and the customer part of `doc`. */
export async function makeCustomer(
  tx: Tx,
  id: string,
  displayName: string,
  doc: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `UPDATE users SET role = 'customer', status = 'active', display_name = $2, doc = doc || $3::jsonb, updated_at = $4
      WHERE id = $1`,
    [id, displayName, JSON.stringify(doc), new Date(tx.now)],
  );
  await publishChange(tx, 'users', 'updated', { uid: id, role: 'customer' });
}

export async function renameCustomer(tx: Tx, id: string, displayName: string): Promise<void> {
  await tx.query(`UPDATE users SET display_name = $2, updated_at = $3 WHERE id = $1`, [
    id,
    displayName,
    new Date(tx.now),
  ]);
  await publishChange(tx, 'users', 'updated', { uid: id, role: 'customer' });
}

// ---------- what a checkout reads: stores, products, jobsites, cards ----------

export interface CheckoutStoreRecord {
  id: string;
  store: Omit<Store, 'id' | 'rating' | 'ratingCount' | 'photoUrl' | 'createdAt' | 'updatedAt'>;
  settings: StorePrivateSettings;
}

export async function readStores(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, CheckoutStoreRecord>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{
    id: string;
    doc: CheckoutStoreRecord['store'];
    settings: StorePrivateSettings;
  }>('SELECT id, doc, settings FROM stores WHERE id = ANY($1::text[])', [[...new Set(ids)]]);
  return new Map(rows.map((row) => [row.id, { id: row.id, store: row.doc, settings: row.settings }]));
}

/** A product as a checkout needs it: the document plus stock and the listing flag. */
export interface CheckoutProduct {
  id: string;
  storeId: string;
  doc: Omit<
    Product,
    | 'id'
    | 'storeId'
    | 'stockOnHand'
    | 'reserved'
    | 'listed'
    | 'storeName'
    | 'storeStatus'
    | 'searchTerms'
    | 'imageUrl'
    | 'createdAt'
    | 'updatedAt'
  >;
  stockOnHand: number;
  reserved: number;
  listed: boolean;
}

interface ProductDbRow {
  id: string;
  store_id: string;
  doc: CheckoutProduct['doc'];
  stock_on_hand: number;
  reserved: number;
  listed: boolean;
}

const toCheckoutProduct = (row: ProductDbRow): CheckoutProduct => ({
  id: row.id,
  storeId: row.store_id,
  doc: row.doc,
  stockOnHand: row.stock_on_hand,
  reserved: row.reserved,
  listed: row.listed,
});

export async function readProducts(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, CheckoutProduct>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<ProductDbRow>(
    'SELECT id, store_id, doc, stock_on_hand, reserved, listed FROM products WHERE id = ANY($1::text[])',
    [[...new Set(ids)]],
  );
  return new Map(rows.map((row) => [row.id, toCheckoutProduct(row)]));
}

/** Statement (a) of §3.5 on products (rank 10), returning what a checkout re-validates under the lock. */
export async function lockProducts(tx: Tx, ids: readonly string[]): Promise<Map<string, CheckoutProduct>> {
  if (ids.length === 0) return new Map();
  const { rows } = await tx.query<ProductDbRow>(
    `SELECT id, store_id, doc, stock_on_hand, reserved, listed FROM products
      WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" FOR NO KEY UPDATE`,
    [[...new Set(ids)]],
  );
  return new Map(rows.map((row) => [row.id, toCheckoutProduct(row)]));
}

export interface CheckoutJobsite {
  id: string;
  userId: string;
  fields: JobsiteFields;
}

export async function readJobsite(db: Queryable, id: string): Promise<CheckoutJobsite | null> {
  const { rows } = await db.query<{ id: string; user_id: string; doc: CheckoutJobsite['fields'] }>(
    'SELECT id, user_id, doc FROM jobsites WHERE id = $1',
    [id],
  );
  const row = rows[0];
  return row ? { id: row.id, userId: row.user_id, fields: row.doc } : null;
}

export interface CheckoutCard {
  id: string;
  userId: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
}

export async function readCard(db: Queryable, id: string): Promise<CheckoutCard | null> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    brand: CheckoutCard['brand'];
    last4: string;
    exp_month: number;
    exp_year: number;
  }>('SELECT id, user_id, brand, last4, exp_month, exp_year FROM cards WHERE id = $1', [id]);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        brand: row.brand,
        last4: row.last4,
        expMonth: row.exp_month,
        expYear: row.exp_year,
      }
    : null;
}

// ---------- the outbox, read for the automatic refund (§9.2.12) ----------

/** Σ amountCents of `refund_adj_…` refunds still pending or processing, per store order of the order. */
export async function refundsInFlight(
  tx: Tx,
  storeOrderIds: readonly string[],
): Promise<Map<string, number>> {
  if (storeOrderIds.length === 0) return new Map();
  const { rows } = await tx.query<{ store_order_id: string; cents: number }>(
    `SELECT payload->>'storeOrderId' AS store_order_id, COALESCE(sum((payload->>'amountCents')::bigint), 0)::bigint AS cents
       FROM outbox
      WHERE event = 'payment.refund' AND status IN ('pending', 'processing')
        AND payload->>'storeOrderId' = ANY($1::text[])
        AND payload->>'idempotencyKey' LIKE 'refund\\_adj\\_%'
      GROUP BY 1`,
    [[...storeOrderIds]],
  );
  return new Map(rows.map((row) => [row.store_order_id, row.cents]));
}
