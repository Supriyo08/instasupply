/**
 * The stock statements (b) of docs/PLATFORM.md §3.5. The product rows are locked by the caller (lockGraph with
 * `productIds`); a product that no longer exists matches no row, which is fine (MARKETPLACE §5.5.2). Every
 * changed product is published on `store:{storeId}:products` and `product:{id}` (§8.2).
 */
import type { Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Changed = { id: string; store_id: string };

async function published(tx: Tx, rows: Changed[]): Promise<void> {
  for (const row of rows)
    await publishChange(tx, 'products', 'updated', { id: row.id, storeId: row.store_id });
}

export async function reserveStock(tx: Tx, productId: string, quantity: number): Promise<void> {
  const { rows } = await tx.query<Changed>(
    'UPDATE products SET reserved = reserved + $2, updated_at = $3 WHERE id = $1 RETURNING id, store_id',
    [productId, quantity, new Date(tx.now)],
  );
  await published(tx, rows);
}

/** `clamp`: the reason is out_of_stock, so on hand drops to what stays reserved (available becomes 0). */
export async function releaseStock(
  tx: Tx,
  productId: string,
  quantity: number,
  clamp: boolean,
): Promise<void> {
  const { rows } = await tx.query<Changed>(
    `UPDATE products SET reserved = GREATEST(reserved - $2, 0),
            stock_on_hand = CASE WHEN $3 THEN LEAST(stock_on_hand, GREATEST(reserved - $2, 0)) ELSE stock_on_hand END,
            updated_at = $4
      WHERE id = $1 RETURNING id, store_id`,
    [productId, quantity, clamp, new Date(tx.now)],
  );
  await published(tx, rows);
}

/** The hand-over: the goods leave the shelf and stop being reserved. */
export async function commitStock(tx: Tx, productId: string, quantity: number): Promise<void> {
  const { rows } = await tx.query<Changed>(
    `UPDATE products SET stock_on_hand = GREATEST(stock_on_hand - $2, 0),
            reserved = GREATEST(reserved - $2, 0), updated_at = $3
      WHERE id = $1 RETURNING id, store_id`,
    [productId, quantity, new Date(tx.now)],
  );
  await published(tx, rows);
}

/** A return to store: the goods go back on the shelf. */
export async function restockStock(tx: Tx, productId: string, quantity: number): Promise<void> {
  const { rows } = await tx.query<Changed>(
    `UPDATE products SET stock_on_hand = LEAST(stock_on_hand + $2, 1000000), updated_at = $3
      WHERE id = $1 RETURNING id, store_id`,
    [productId, quantity, new Date(tx.now)],
  );
  await published(tx, rows);
}
