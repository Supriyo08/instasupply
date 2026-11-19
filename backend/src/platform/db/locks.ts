/**
 * Row locks in one global order (docs/PLATFORM.md §3.6). A transaction takes locks in ascending rank and,
 * within a table, in ascending id, so no lock cycle can form. `FOR NO KEY UPDATE` (R1) excludes other
 * writers without blocking the FOR KEY SHARE that foreign-key checks take on parent rows.
 */
import { RetryTransaction, type Tx } from './tx';

export const LOCK_RANK = {
  users: 1,
  quotes: 2,
  issues: 3,
  orders: 4,
  store_orders: 5,
  deliveries: 6,
  job_offers: 7,
  stores: 8,
  categories: 9,
  products: 10,
  support_threads: 11,
  chat_threads: 12,
  payouts: 13,
  ledger_entries: 14,
} as const;

export type LockableTable = keyof typeof LOCK_RANK;

/** Primary-key column per table; two tables are keyed by another row's id. */
const KEY: Record<LockableTable, string> = {
  users: 'id',
  quotes: 'id',
  issues: 'id',
  orders: 'id',
  store_orders: 'id',
  deliveries: 'id',
  job_offers: 'delivery_id',
  stores: 'id',
  categories: 'id',
  products: 'id',
  support_threads: 'id',
  chat_threads: 'driver_id',
  payouts: 'id',
  ledger_entries: 'id',
};

/** Raw rows as PostgreSQL returns them (instants already parsed to epoch ms). Repositories map them. */
export type Row = Record<string, unknown>;
export interface DocRow<D = Record<string, unknown>> {
  id: string;
  doc: D;
  created_at: number;
  updated_at: number;
  [column: string]: unknown;
}
export type UserRow = DocRow & {
  email: string;
  role: string | null;
  status: string;
  store_id: string | null;
  store_role: string | null;
  city_id: string | null;
  capacity_class: string | null;
  display_name: string;
  phone_number: string | null;
  phone_verified: boolean;
};
export type QuoteRow = DocRow & { customer_id: string; status: string; order_id: string | null };
export type IssueRow = DocRow & {
  customer_id: string;
  store_id: string;
  order_id: string;
  store_order_id: string;
};
export type OrderRow = DocRow & { customer_id: string; status: string; payment_status: string };
export type StoreOrderRow = DocRow & {
  order_id: string;
  store_id: string;
  customer_id: string;
  status: string;
  version: number;
  delivery_id: string | null;
  meta: Record<string, unknown>;
};
export type DeliveryRow = DocRow & {
  status: string;
  driver_id: string | null;
  customer_id: string | null;
  source_order_id: string | null;
  store_order_id: string | null;
  store_id: string | null;
  meta: Record<string, unknown>;
};
export type JobOfferRow = Omit<DocRow, 'id'> & { delivery_id: string; status: string; audience: string[] };
export type ProductRow = DocRow & { store_id: string; stock_on_hand: number; reserved: number };

/** Statement (a) of §3.5: one statement per table, ids sorted by the database, the weakest sufficient lock. */
export async function lockRows<R>(
  tx: Tx,
  table: LockableTable,
  ids: readonly string[],
  mode: 'update' | 'share' = 'update',
): Promise<R[]> {
  if (ids.length === 0) return [];
  const key = KEY[table];
  const lock = mode === 'share' ? 'FOR SHARE' : 'FOR NO KEY UPDATE';
  const { rows } = await tx.query<R>(
    `SELECT * FROM ${table} WHERE ${key} = ANY($1::text[]) ORDER BY ${key} COLLATE "C" ${lock}`,
    [[...new Set(ids)]],
  );
  return rows;
}

export interface GraphSeed {
  orderIds?: string[];
  storeOrderIds?: string[];
  deliveryIds?: string[];
  userIds?: string[];
  quoteIds?: string[];
  issueIds?: string[];
  productIds?: string[];
  withOffers?: boolean;
}

export interface LockedGraph {
  users: Map<string, UserRow>;
  quotes: Map<string, QuoteRow>;
  issues: Map<string, IssueRow>;
  orders: Map<string, OrderRow>;
  storeOrders: Map<string, StoreOrderRow>;
  deliveries: Map<string, DeliveryRow>;
  offers: Map<string, JobOfferRow>;
  products: Map<string, ProductRow>;
}

const keyed = <R extends { id: string }>(rows: R[]): Map<string, R> =>
  new Map(rows.map((row) => [row.id, row]));

/**
 * Rule 3 of §3.6, "keys first, locks second": resolve the closure of the seed with plain reads, lock it in
 * rank order, then check that the one mutable key (deliveries.driver_id) did not change in between.
 */
export async function lockGraph(tx: Tx, seed: GraphSeed): Promise<LockedGraph> {
  const users = new Set(seed.userIds ?? []);
  const quotes = new Set(seed.quoteIds ?? []);
  const issues = new Set(seed.issueIds ?? []);
  const orders = new Set(seed.orderIds ?? []);
  const storeOrders = new Set(seed.storeOrderIds ?? []);
  const deliveries = new Set(seed.deliveryIds ?? []);

  if (quotes.size > 0) {
    const { rows } = await tx.query<{ customer_id: string; order_id: string | null }>(
      'SELECT customer_id, order_id FROM quotes WHERE id = ANY($1::text[])',
      [[...quotes]],
    );
    for (const row of rows) {
      users.add(row.customer_id);
      if (row.order_id) orders.add(row.order_id);
    }
  }
  if (issues.size > 0) {
    const { rows } = await tx.query<{ customer_id: string; order_id: string; store_order_id: string }>(
      'SELECT customer_id, order_id, store_order_id FROM issues WHERE id = ANY($1::text[])',
      [[...issues]],
    );
    for (const row of rows) {
      users.add(row.customer_id);
      orders.add(row.order_id);
      storeOrders.add(row.store_order_id);
    }
  }
  if (deliveries.size > 0) {
    const { rows } = await tx.query<{ store_order_id: string | null; source_order_id: string | null }>(
      'SELECT store_order_id, source_order_id FROM deliveries WHERE id = ANY($1::text[])',
      [[...deliveries]],
    );
    for (const row of rows) {
      if (row.store_order_id) storeOrders.add(row.store_order_id);
      if (row.source_order_id) orders.add(row.source_order_id);
    }
  }
  if (storeOrders.size > 0) {
    const { rows } = await tx.query<{ order_id: string; delivery_id: string | null }>(
      'SELECT order_id, delivery_id FROM store_orders WHERE id = ANY($1::text[])',
      [[...storeOrders]],
    );
    for (const row of rows) {
      orders.add(row.order_id);
      if (row.delivery_id) deliveries.add(row.delivery_id);
    }
  }
  if (orders.size > 0) {
    const { rows } = await tx.query<{ customer_id: string }>(
      'SELECT customer_id FROM orders WHERE id = ANY($1::text[])',
      [[...orders]],
    );
    for (const row of rows) users.add(row.customer_id);
  }
  const driversSeen = new Map<string, string | null>();
  if (deliveries.size > 0) {
    const { rows } = await tx.query<{ id: string; driver_id: string | null; customer_id: string | null }>(
      'SELECT id, driver_id, customer_id FROM deliveries WHERE id = ANY($1::text[])',
      [[...deliveries]],
    );
    for (const row of rows) {
      driversSeen.set(row.id, row.driver_id);
      if (row.driver_id) users.add(row.driver_id);
      if (row.customer_id) users.add(row.customer_id);
    }
  }

  const graph: LockedGraph = {
    users: keyed(await lockRows<UserRow>(tx, 'users', [...users])),
    quotes: keyed(await lockRows<QuoteRow>(tx, 'quotes', [...quotes])),
    issues: keyed(await lockRows<IssueRow>(tx, 'issues', [...issues])),
    orders: keyed(await lockRows<OrderRow>(tx, 'orders', [...orders])),
    storeOrders: keyed(await lockRows<StoreOrderRow>(tx, 'store_orders', [...storeOrders])),
    deliveries: keyed(await lockRows<DeliveryRow>(tx, 'deliveries', [...deliveries])),
    offers: new Map(),
    products: new Map(),
  };
  if (seed.withOffers && deliveries.size > 0) {
    const offers = await lockRows<JobOfferRow>(tx, 'job_offers', [...deliveries]);
    graph.offers = new Map(offers.map((offer) => [offer.delivery_id, offer]));
  }
  if (seed.productIds && seed.productIds.length > 0) {
    graph.products = keyed(await lockRows<ProductRow>(tx, 'products', seed.productIds));
  }

  for (const [id, delivery] of graph.deliveries) {
    if (delivery.driver_id !== (driversSeen.get(id) ?? null)) throw new RetryTransaction();
  }
  return graph;
}
