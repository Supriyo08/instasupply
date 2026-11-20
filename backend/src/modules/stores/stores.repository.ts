/**
 * SQL of the `stores` table and its row ↔ document mapping (docs/PLATFORM.md §3.1, §3.3). `doc` holds the
 * Store without `id`, `rating`, `ratingCount`, `createdAt`, `updatedAt` and `photoUrl`, plus `photoPath`;
 * the rating comes from the two owned columns. `settings` is private: only the functions named *Settings
 * read it.
 */
import type { Store, StorePrivateSettings, StoreStatus } from '@instasupply/shared';
import { lockRows } from '../../platform/db/locks';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';
import { mediaUrl } from '../../platform/storage/files.service';

export type StoreDoc = Omit<
  Store,
  'id' | 'rating' | 'ratingCount' | 'createdAt' | 'updatedAt' | 'photoUrl'
> & {
  /** A confirmed `storePhotos/{storeId}/…` upload, or null. */
  photoPath: string | null;
};

export interface StoreRow {
  id: string;
  doc: StoreDoc;
  rating_sum: number;
  rating_count: number;
  created_at: number;
  updated_at: number;
}

export interface StoreRecord {
  id: string;
  doc: StoreDoc;
  ratingSum: number;
  ratingCount: number;
  createdAt: number;
  updatedAt: number;
}

const COLUMNS = 'id, doc, rating_sum, rating_count, created_at, updated_at';

export const toRecord = (row: StoreRow): StoreRecord => ({
  id: row.id,
  doc: { ...row.doc, photoPath: row.doc.photoPath ?? null },
  ratingSum: row.rating_sum,
  ratingCount: row.rating_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** `round(rating_sum × 10 / rating_count) / 10`, or 0 without reviews (§3.3). */
export const ratingOf = (sum: number, count: number): number =>
  count > 0 ? Math.round((sum * 10) / count) / 10 : 0;

/** The public Store (§3.3): `photoUrl` derived from `photoPath`, rating from the owned columns. */
export function toStore(record: StoreRecord, origin: string): Store {
  const { photoPath, ...doc } = record.doc;
  return {
    ...doc,
    id: record.id,
    photoUrl: mediaUrl(origin, photoPath),
    rating: ratingOf(record.ratingSum, record.ratingCount),
    ratingCount: record.ratingCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** What publishChange needs for `stores` and `store_settings` (§8.2): the id. */
const liveRow = (id: string) => ({ id });

export async function findStore(db: Queryable, id: string): Promise<StoreRecord | null> {
  const { rows } = await db.query<StoreRow>(`SELECT ${COLUMNS} FROM stores WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** GET /stores: one market, optional statuses, ordered by name then id (keyset). */
export async function listStores(
  db: Queryable,
  filter: { marketId: string; statuses: StoreStatus[] | null },
  after: { name: string; id: string } | null,
  limit: number,
): Promise<StoreRecord[]> {
  const values: unknown[] = [filter.marketId];
  const where = ['market_id = $1'];
  if (filter.statuses && filter.statuses.length > 0) {
    values.push(filter.statuses);
    where.push(`status = ANY($${values.length}::text[])`);
  }
  if (after) {
    values.push(after.name, after.id);
    where.push(`(name, id) > ($${values.length - 1}, $${values.length})`);
  }
  values.push(limit + 1);
  const { rows } = await db.query<StoreRow>(
    `SELECT ${COLUMNS} FROM stores WHERE ${where.join(' AND ')} ORDER BY name, id LIMIT $${values.length}`,
    values,
  );
  return rows.map(toRecord);
}

/** Statement (a) of §3.5 on `stores` (rank 8): `update` for a store being written, `share` for a product's store. */
export async function lockStore(
  tx: Tx,
  id: string,
  mode: 'update' | 'share' = 'update',
): Promise<StoreRecord | null> {
  const [row] = await lockRows<StoreRow>(tx, 'stores', [id], mode);
  return row ? toRecord(row) : null;
}

/** createStore: false when the slug is taken (the natural key of §4.5). */
export async function insertStore(
  tx: Tx,
  id: string,
  doc: StoreDoc,
  settings: StorePrivateSettings,
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `INSERT INTO stores (id, doc, settings, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, JSON.stringify(doc), JSON.stringify(settings), new Date(tx.now)],
  );
  if (rowCount === 0) return false;
  await publishChange(tx, 'stores', 'created', liveRow(id));
  return true;
}

/** The row must be locked by the caller. Sets updated_at = tx.now. */
export async function saveStoreDoc(tx: Tx, id: string, doc: StoreDoc): Promise<void> {
  await tx.query('UPDATE stores SET doc = $2::jsonb, updated_at = $3 WHERE id = $1', [
    id,
    JSON.stringify(doc),
    new Date(tx.now),
  ]);
  await publishChange(tx, 'stores', 'updated', liveRow(id));
}

export async function findStoreSettings(db: Queryable, id: string): Promise<StorePrivateSettings | null> {
  const { rows } = await db.query<{ settings: StorePrivateSettings }>(
    'SELECT settings FROM stores WHERE id = $1',
    [id],
  );
  return rows[0]?.settings ?? null;
}

/** The row must be locked by the caller. Private settings publish on `store:{id}` only (§8.2). */
export async function saveStoreSettings(tx: Tx, id: string, settings: StorePrivateSettings): Promise<void> {
  await tx.query('UPDATE stores SET settings = $2::jsonb, updated_at = $3 WHERE id = $1', [
    id,
    JSON.stringify(settings),
    new Date(tx.now),
  ]);
  await publishChange(tx, 'store_settings', 'updated', liveRow(id));
}

/**
 * onStoreReviewWritten (§9.4): the rating columns recomputed from store_reviews. The store row must be
 * locked by the caller.
 */
export async function recomputeStoreRating(tx: Tx, id: string): Promise<{ sum: number; count: number }> {
  const { rows } = await tx.query<{ rating_sum: number; rating_count: number }>(
    `UPDATE stores s SET (rating_sum, rating_count) =
       (SELECT COALESCE(sum(r.rating), 0)::integer, count(*)::integer FROM store_reviews r WHERE r.store_id = $1),
       updated_at = $2
     WHERE s.id = $1 RETURNING rating_sum, rating_count`,
    [id, new Date(tx.now)],
  );
  await publishChange(tx, 'stores', 'updated', liveRow(id));
  const row = rows[0];
  return { sum: row?.rating_sum ?? 0, count: row?.rating_count ?? 0 };
}
