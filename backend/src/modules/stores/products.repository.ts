/**
 * SQL of the `products` table and its row ↔ document mapping (docs/PLATFORM.md §3.1, §3.3, §3.4, §3.5).
 * `doc` holds the Product without `id`, `storeId` and the owned or generated fields; stock, `reserved`, the
 * store copies and `search_terms` are owned columns, `listed` is generated from `active` and `store_status`.
 */
import type { CategoryId, Product, StoreStatus } from '@instasupply/shared';
import { LOW_STOCK_THRESHOLD } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';
import { mediaUrl } from '../../platform/storage/files.service';

/** The fields kept in `doc`. */
export type ProductDoc = Omit<
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

export interface ProductRow {
  id: string;
  store_id: string;
  doc: ProductDoc;
  stock_on_hand: number;
  reserved: number;
  store_name: string;
  store_status: StoreStatus;
  search_terms: string[];
  listed: boolean;
  name_sort: string;
  price_cents: number;
  created_at: number;
  updated_at: number;
}

/** The columns a product is written with besides `doc` (the old server-only fields). */
export interface ProductColumns {
  searchTerms: string[];
  storeName: string;
  storeStatus: StoreStatus;
}

const COLUMNS = `id, store_id, doc, stock_on_hand, reserved, store_name, store_status, search_terms, listed,
  name_sort, price_cents, created_at, updated_at`;

export function toProduct(row: ProductRow, origin: string): Product {
  return {
    ...row.doc,
    id: row.id,
    storeId: row.store_id,
    stockOnHand: row.stock_on_hand,
    reserved: row.reserved,
    listed: row.listed,
    storeName: row.store_name,
    storeStatus: row.store_status,
    searchTerms: row.search_terms,
    imageUrl: mediaUrl(origin, row.doc.imagePath),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** What publishChange needs for `products` (§8.2). */
const liveRow = (row: { id: string; store_id: string }) => ({ id: row.id, storeId: row.store_id });

export async function findProduct(db: Queryable, id: string): Promise<ProductRow | null> {
  const { rows } = await db.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** `ids=` of GET /products: whatever their listed flag; unknown ids are left out. */
export async function findProductsByIds(db: Queryable, ids: readonly string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE id = ANY($1::text[]) ORDER BY id`,
    [[...new Set(ids)]],
  );
  return rows;
}

export interface ProductFilter {
  /** true: listed products only (indexes 1 to 5, 7). false: the portal and ops catalogue (index 6). */
  listed: boolean;
  storeId?: string;
  categoryId?: CategoryId;
  familyKey?: string;
  featured?: boolean;
  inStock?: boolean;
  /** Every key must be in search_terms (searchKeysFor). */
  searchKeys?: string[];
  active?: boolean;
  lowStock?: boolean;
  estimated?: boolean;
}

export type ProductSort = 'name:asc' | 'priceCents:asc';

/** GET /products: one keyset page, `limit + 1` rows, sorted by name (or price within a family) then id. */
export async function listProducts(
  db: Queryable,
  filter: ProductFilter,
  sort: ProductSort,
  after: { value: string | number; id: string } | null,
  limit: number,
): Promise<ProductRow[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replaceAll('?', `$${values.length}`));
  };
  if (filter.listed) where.push('listed');
  if (filter.storeId !== undefined) add('store_id = ?', filter.storeId);
  if (filter.categoryId !== undefined) add('category_id = ?', filter.categoryId);
  if (filter.familyKey !== undefined) add('family_key = ?', filter.familyKey);
  if (filter.featured) where.push('featured');
  if (filter.inStock) where.push('stock_on_hand > reserved');
  if (filter.searchKeys && filter.searchKeys.length > 0) add('search_terms @> ?::text[]', filter.searchKeys);
  if (filter.active !== undefined) add('active = ?', filter.active);
  if (filter.lowStock) add('stock_on_hand - reserved < ?', LOW_STOCK_THRESHOLD);
  if (filter.estimated) where.push(`(doc->>'shipEstimated')::boolean`);
  const key = sort === 'priceCents:asc' ? 'price_cents' : 'name_sort';
  if (after) {
    values.push(after.value, after.id);
    where.push(`(${key}, id) > ($${values.length - 1}, $${values.length})`);
  }
  values.push(limit + 1);
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${key}, id LIMIT $${values.length}`,
    values,
  );
  return rows;
}

/** The row with FOR NO KEY UPDATE (rank 10). */
export async function lockProduct(tx: Tx, id: string): Promise<ProductRow | null> {
  const { rows } = await tx.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

/** Products of one category, locked in id order (statement (a) of §3.5 for a bulk update, rule 5 of §3.6). */
export async function lockProductsOfCategory(tx: Tx, categoryId: string): Promise<ProductRow[]> {
  const { rows } = await tx.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE category_id = $1 ORDER BY id COLLATE "C" FOR NO KEY UPDATE`,
    [categoryId],
  );
  return rows;
}

/** Product PUT: false when the id exists (`already-exists`). `reserved` starts at 0. */
export async function insertProduct(
  tx: Tx,
  input: { id: string; storeId: string; doc: ProductDoc; stockOnHand: number; columns: ProductColumns },
): Promise<ProductRow | null> {
  const { rows } = await tx.query<ProductRow>(
    `INSERT INTO products (id, store_id, doc, stock_on_hand, reserved, store_name, store_status, search_terms,
                           created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, 0, $5, $6, $7::text[], $8, $8)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      input.id,
      input.storeId,
      JSON.stringify(input.doc),
      input.stockOnHand,
      input.columns.storeName,
      input.columns.storeStatus,
      input.columns.searchTerms,
      new Date(tx.now),
    ],
  );
  const row = rows[0] ?? null;
  if (row) await publishChange(tx, 'products', 'created', liveRow(row));
  return row;
}

/** Product PATCH. The row must be locked by the caller; `reserved` is never written here. */
export async function saveProduct(
  tx: Tx,
  input: { id: string; doc: ProductDoc; stockOnHand: number; columns: ProductColumns },
): Promise<ProductRow> {
  const { rows } = await tx.query<ProductRow>(
    `UPDATE products SET doc = $2::jsonb, stock_on_hand = $3, store_name = $4, store_status = $5,
                         search_terms = $6::text[], updated_at = $7
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      input.id,
      JSON.stringify(input.doc),
      input.stockOnHand,
      input.columns.storeName,
      input.columns.storeStatus,
      input.columns.searchTerms,
      new Date(tx.now),
    ],
  );
  const row = rows[0]!;
  await publishChange(tx, 'products', 'updated', liveRow(row));
  return row;
}

/** The stock adjustment of POST /products/{id}/stock-adjust: one statement, clamped to 0…1 000 000. */
export async function adjustStock(tx: Tx, id: string, delta: number): Promise<ProductRow | null> {
  const { rows } = await tx.query<ProductRow>(
    `UPDATE products SET stock_on_hand = LEAST(GREATEST(stock_on_hand + $2, 0), 1000000), updated_at = $3
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, delta, new Date(tx.now)],
  );
  const row = rows[0] ?? null;
  if (row) await publishChange(tx, 'products', 'updated', liveRow(row));
  return row;
}

/** Only rows with reserved = 0 may go (rule 6 of §3.6); false when the row still holds stock. */
export async function deleteProduct(tx: Tx, row: { id: string; store_id: string }): Promise<boolean> {
  const { rowCount } = await tx.query('DELETE FROM products WHERE id = $1 AND reserved = 0', [row.id]);
  if (rowCount === 0) return false;
  await publishChange(tx, 'products', 'deleted', liveRow(row));
  return true;
}

/** New search terms for rows already locked (category edits). */
export async function saveSearchTerms(tx: Tx, row: ProductRow, searchTerms: string[]): Promise<void> {
  await tx.query('UPDATE products SET search_terms = $2::text[], updated_at = $3 WHERE id = $1', [
    row.id,
    searchTerms,
    new Date(tx.now),
  ]);
  await publishChange(tx, 'products', 'updated', liveRow(row));
}

/** Statement (h) of §3.5: lock the store's products in id order, then one UPDATE. Returns the product ids. */
export async function fanOutStoreColumns(
  tx: Tx,
  storeId: string,
  storeName: string,
  storeStatus: StoreStatus,
): Promise<ProductRow[]> {
  await tx.query('SELECT id FROM products WHERE store_id = $1 ORDER BY id COLLATE "C" FOR NO KEY UPDATE', [
    storeId,
  ]);
  const { rows } = await tx.query<ProductRow>(
    `UPDATE products SET store_name = $2, store_status = $3, updated_at = $4
      WHERE store_id = $1 AND (store_name IS DISTINCT FROM $2 OR store_status IS DISTINCT FROM $3)
      RETURNING ${COLUMNS}`,
    [storeId, storeName, storeStatus, new Date(tx.now)],
  );
  for (const row of rows) await publishChange(tx, 'products', 'updated', liveRow(row));
  return rows;
}
