/**
 * SQL of `store_reviews` (no `doc`: every field is a column, docs/PLATFORM.md §3.1 rule 5) and the one
 * store-order flag the review owns (`rated`). The API shape is `WithId<StoreReview>`, `id` = store order id.
 */
import type { StoreReview, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

export interface ReviewRow {
  id: string;
  store_id: string;
  store_order_id: string | null;
  customer_id: string;
  author_name: string;
  rating: number;
  text: string;
  created_at: number;
  updated_at: number;
}

const COLUMNS =
  'id, store_id, store_order_id, customer_id, author_name, rating, text, created_at, updated_at';

export const toReview = (row: ReviewRow): WithId<StoreReview> => ({
  id: row.id,
  storeId: row.store_id,
  storeOrderId: row.id,
  customerId: row.customer_id,
  authorName: row.author_name,
  rating: row.rating,
  text: row.text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function findReview(db: Queryable, storeId: string, id: string): Promise<ReviewRow | null> {
  const { rows } = await db.query<ReviewRow>(
    `SELECT ${COLUMNS} FROM store_reviews WHERE id = $1 AND store_id = $2`,
    [id, storeId],
  );
  return rows[0] ?? null;
}

/** Newest first, keyset on (updated_at, id) (index store_reviews_store_idx). */
export async function listReviews(
  db: Queryable,
  storeId: string,
  after: { updatedAt: number; id: string } | null,
  limit: number,
): Promise<ReviewRow[]> {
  const { rows } = after
    ? await db.query<ReviewRow>(
        `SELECT ${COLUMNS} FROM store_reviews WHERE store_id = $1 AND (updated_at, id) < ($2, $3)
          ORDER BY updated_at DESC, id DESC LIMIT $4`,
        [storeId, new Date(after.updatedAt), after.id, limit + 1],
      )
    : await db.query<ReviewRow>(
        `SELECT ${COLUMNS} FROM store_reviews WHERE store_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`,
        [storeId, limit + 1],
      );
  return rows;
}

/** Create or replace the review of one store order; `created_at` survives an edit. */
export async function upsertReview(
  tx: Tx,
  review: {
    storeOrderId: string;
    storeId: string;
    customerId: string;
    authorName: string;
    rating: number;
    text: string;
  },
): Promise<ReviewRow> {
  const { rows } = await tx.query<ReviewRow>(
    `INSERT INTO store_reviews (id, store_id, store_order_id, customer_id, author_name, rating, text, created_at,
                                updated_at)
     VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (id) DO UPDATE SET author_name = EXCLUDED.author_name, rating = EXCLUDED.rating,
                                    text = EXCLUDED.text, updated_at = EXCLUDED.updated_at
     RETURNING ${COLUMNS}`,
    [
      review.storeOrderId,
      review.storeId,
      review.customerId,
      review.authorName,
      review.rating,
      review.text,
      new Date(tx.now),
    ],
  );
  return rows[0]!;
}

export async function deleteReview(tx: Tx, id: string): Promise<void> {
  await tx.query('DELETE FROM store_reviews WHERE id = $1', [id]);
}

/**
 * The store order's `rated` flag (the old `onStoreReviewWritten`). The store order is locked by the caller
 * (lockGraph); only a real change writes the row and publishes its topics. `version` is not touched: a
 * rating is not a step of the store-order machine, so no portal action conflicts with it.
 */
export async function setStoreOrderRated(
  tx: Tx,
  storeOrder: { id: string; order_id: string; customer_id: string; store_id: string },
  rated: boolean,
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE store_orders SET doc = jsonb_set(doc, '{rated}', to_jsonb($2::boolean)), updated_at = $3
      WHERE id = $1 AND (doc->'rated') IS DISTINCT FROM to_jsonb($2::boolean)`,
    [storeOrder.id, rated, new Date(tx.now)],
  );
  if (rowCount === 0) return;
  await publishChange(tx, 'store_orders', 'updated', {
    id: storeOrder.id,
    orderId: storeOrder.order_id,
    customerId: storeOrder.customer_id,
    storeId: storeOrder.store_id,
  });
}
