/**
 * Every SQL statement of the quotes module (docs/PLATFORM.md §2.1, §3.2 `quotes`, §3.3, §3.5): the quote rows
 * and their private workspace, the plain reads a quote needs (the customer, a jobsite, catalogue products,
 * stores, an order) and the expiry candidates. Each write announces itself with publishChange.
 */
import {
  formatAddressLine,
  type DimsCm,
  type JobsiteFields,
  type JobsiteSnapshot,
  type Order,
  type Quote,
  type QuoteStatus,
  type SellUnit,
} from '@instasupply/shared';
import { jsonb } from '../../platform/db/json';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

// ---------- quotes ----------

type QuoteDoc = Omit<Quote, 'id' | 'createdAt' | 'updatedAt'>;
interface QuoteDbRow {
  id: string;
  doc: QuoteDoc;
  created_at: number;
  updated_at: number;
}
const QUOTE_COLUMNS = 'id, doc, created_at, updated_at';

const toQuote = (row: QuoteDbRow): Quote => ({
  ...row.doc,
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const splitQuote = (quote: Quote): QuoteDoc => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...doc } = quote;
  return doc;
};

/** The live topics of §8.2 need the id and the customer. */
const announce = (tx: Tx, kind: 'created' | 'updated', quote: Quote) =>
  publishChange(tx, 'quotes', kind, { id: quote.id, customerId: quote.customerId });

export async function findQuote(db: Queryable, id: string): Promise<Quote | null> {
  const { rows } = await db.query<QuoteDbRow>(`SELECT ${QUOTE_COLUMNS} FROM quotes WHERE id = $1`, [id]);
  return rows[0] ? toQuote(rows[0]) : null;
}

/** Rank 2 of §3.6. The caller holds users(customer) first when it also writes an order. */
export async function lockQuote(tx: Tx, id: string): Promise<Quote | null> {
  const { rows } = await tx.query<QuoteDbRow>(
    `SELECT ${QUOTE_COLUMNS} FROM quotes WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ? toQuote(rows[0]) : null;
}

export async function quoteCustomerId(db: Queryable, id: string): Promise<string | null> {
  const { rows } = await db.query<{ customer_id: string }>('SELECT customer_id FROM quotes WHERE id = $1', [
    id,
  ]);
  return rows[0]?.customer_id ?? null;
}

/** Inserts a new quote; false when a row with this id exists already (a concurrent retry, D17). */
export async function insertQuote(tx: Tx, quote: Quote): Promise<boolean> {
  const { rowCount } = await tx.query(
    `INSERT INTO quotes (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [quote.id, jsonb(splitQuote(quote)), new Date(quote.createdAt), new Date(quote.updatedAt)],
  );
  if (rowCount === 0) return false;
  await announce(tx, 'created', quote);
  return true;
}

/** The row must be locked by the caller (§3.6). Sets updated_at = tx.now. */
export async function saveQuote(tx: Tx, quote: Quote): Promise<Quote> {
  const saved: Quote = { ...quote, updatedAt: tx.now };
  await tx.query(`UPDATE quotes SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`, [
    quote.id,
    jsonb(splitQuote(saved)),
    new Date(tx.now),
  ]);
  await announce(tx, 'updated', saved);
  return saved;
}

export type QuoteSort = 'createdAt:desc' | 'respondBy:asc';

export interface QuoteFilter {
  customerId?: string;
  statuses?: QuoteStatus[];
  assignedTo?: string;
  sort: QuoteSort;
  limit: number;
  /** The sort value and id of the last row of the previous page. */
  after: { value: number; id: string } | null;
}

/** Keyset page (§4.4) over indexes 22 to 24: `limit + 1` rows. */
export async function listQuotes(db: Queryable, filter: QuoteFilter): Promise<Quote[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: (n: string) => string, value: unknown) => {
    values.push(value);
    where.push(clause(`$${values.length}`));
  };
  if (filter.customerId !== undefined) add((n) => `customer_id = ${n}`, filter.customerId);
  if (filter.statuses !== undefined) add((n) => `status = ANY(${n}::text[])`, filter.statuses);
  if (filter.assignedTo !== undefined) add((n) => `assigned_to = ${n}`, filter.assignedTo);
  const byRespondBy = filter.sort === 'respondBy:asc';
  const column = byRespondBy ? 'respond_by' : 'created_at';
  if (filter.after) {
    values.push(new Date(filter.after.value), filter.after.id);
    const op = byRespondBy ? '>' : '<';
    where.push(`(${column}, id) ${op} ($${values.length - 1}, $${values.length})`);
  }
  values.push(filter.limit + 1);
  const order = byRespondBy ? `respond_by ASC, id ASC` : `created_at DESC, id DESC`;
  const { rows } = await db.query<QuoteDbRow>(
    `SELECT ${QUOTE_COLUMNS} FROM quotes ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order} LIMIT $${values.length}`,
    values,
  );
  return rows.map(toQuote);
}

/** Index 25: quoted offers whose time ran out. */
export async function expiredQuoteCandidates(
  db: Queryable,
  now: number,
  skip: readonly string[],
): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM quotes
      WHERE status = 'quoted' AND offer_valid_until <= $1 AND NOT (id = ANY($2::text[]))
      ORDER BY offer_valid_until, id LIMIT 200`,
    [new Date(now), [...skip]],
  );
  return rows.map((row) => row.id);
}

// ---------- the private workspace (§5.3.7) ----------

export async function readWorkspace(db: Queryable, id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query<{ workspace: Record<string, unknown> | null }>(
    'SELECT workspace FROM quotes WHERE id = $1',
    [id],
  );
  return rows[0]?.workspace ?? null;
}

/** Opaque to the server; nothing is published (no topic covers the workspace). False when the quote is gone. */
export async function writeWorkspace(
  db: Queryable,
  id: string,
  workspace: Record<string, unknown>,
): Promise<boolean> {
  const { rowCount } = await db.query('UPDATE quotes SET workspace = $2::jsonb WHERE id = $1', [
    id,
    jsonb(workspace),
  ]);
  return (rowCount ?? 0) > 0;
}

// ---------- what a quote reads ----------

export interface QuoteCustomer {
  id: string;
  role: string | null;
  status: string;
  displayName: string;
  email: string;
  phoneNumber: string | null;
  phoneVerified: boolean;
  companyName: string | null;
}

export async function readQuoteCustomer(db: Queryable, id: string): Promise<QuoteCustomer | null> {
  const { rows } = await db.query<{
    id: string;
    role: string | null;
    status: string;
    display_name: string;
    email: string;
    phone_number: string | null;
    phone_verified: boolean;
    company_name: string | null;
  }>(
    `SELECT id, role, status, display_name, email, phone_number, phone_verified, doc->>'companyName' AS company_name
       FROM users WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        role: row.role,
        status: row.status,
        displayName: row.display_name,
        email: row.email,
        phoneNumber: row.phone_number,
        phoneVerified: row.phone_verified,
        companyName: row.company_name,
      }
    : null;
}

/** The customer's own jobsite as a snapshot (MARKETPLACE §1.3), or null when it is not theirs. */
export async function readJobsiteSnapshot(
  db: Queryable,
  id: string,
  userId: string,
): Promise<JobsiteSnapshot | null> {
  const { rows } = await db.query<{ id: string; doc: JobsiteFields }>(
    'SELECT id, doc FROM jobsites WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  const row = rows[0];
  return row ? { ...row.doc, jobsiteId: row.id, addressLine: formatAddressLine(row.doc) } : null;
}

export interface QuoteProduct {
  id: string;
  storeId: string;
  storeName: string;
  listed: boolean;
  sku: string;
  name: string;
  brand: string | null;
  unit: SellUnit;
  size: string | null;
  priceCents: number;
  weightKg: number;
  dimsCm: DimsCm;
}

export async function readQuoteProducts(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, QuoteProduct>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{
    id: string;
    store_id: string;
    store_name: string;
    listed: boolean;
    doc: {
      sku: string;
      name: string;
      brand: string | null;
      unit: SellUnit;
      size: string | null;
      priceCents: number;
      weightKg: number;
      dimsCm: DimsCm;
    };
  }>('SELECT id, store_id, store_name, listed, doc FROM products WHERE id = ANY($1::text[])', [[...ids]]);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        storeId: row.store_id,
        storeName: row.store_name,
        listed: row.listed,
        sku: row.doc.sku,
        name: row.doc.name,
        brand: row.doc.brand ?? null,
        unit: row.doc.unit,
        size: row.doc.size ?? null,
        priceCents: row.doc.priceCents,
        weightKg: row.doc.weightKg,
        dimsCm: row.doc.dimsCm,
      },
    ]),
  );
}

export async function readStoreNames(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, { name: string; status: string }>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; name: string; status: string }>(
    `SELECT id, doc->>'name' AS name, doc->>'status' AS status FROM stores WHERE id = ANY($1::text[])`,
    [[...ids]],
  );
  return new Map(rows.map((row) => [row.id, { name: row.name, status: row.status }]));
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

/** Rank 1 of §3.6 (R4): the customer row, before the quote. */
export async function lockUser(tx: Tx, id: string): Promise<void> {
  await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [id]);
}

/** Active staff (assignee check of PATCH /quotes and /issues). */
export async function activeStaffName(db: Queryable, uid: string): Promise<string | null> {
  const { rows } = await db.query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1 AND role IN ('admin', 'dispatcher') AND status = 'active'`,
    [uid],
  );
  return rows[0]?.display_name ?? null;
}
