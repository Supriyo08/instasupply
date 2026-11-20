/**
 * Stock helpers of docs/PLATFORM.md §9.1 (MARKETPLACE D3): available = stockOnHand − reserved, never stored.
 * Checkout reserves; reject, cancel and short shipments release; the hand-over at the store commits; a
 * return to store restocks. Callers hold the product row locks (lockGraph with `productIds`, rank 10).
 */
import type { StoreOrderLine } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { commitStock, releaseStock, reserveStock, restockStock } from './stock.repository';

/** One product quantity; the owner may extend it. */
export interface StockLine {
  productId: string;
  quantity: number;
}

/**
 * Sums quantities per product, drops zero and negative quantities, and orders by product id, so two
 * transactions touching the same products update them in the same order.
 */
export function mergeStockLines(lines: readonly StockLine[]): StockLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) continue;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productId, quantity]) => ({ productId, quantity }));
}

/** The catalog lines of a store order with the quantity it still holds (`fulfilledQty`). */
export function stockLinesOf(
  lines: readonly Pick<StoreOrderLine, 'kind' | 'productId' | 'fulfilledQty'>[],
): StockLine[] {
  return mergeStockLines(
    lines.flatMap((line) =>
      line.kind === 'catalog' && line.productId
        ? [{ productId: line.productId, quantity: line.fulfilledQty }]
        : [],
    ),
  );
}

export async function stageStockReserve(tx: Tx, lines: readonly StockLine[]): Promise<void> {
  for (const line of mergeStockLines(lines)) await reserveStock(tx, line.productId, line.quantity);
}

export async function stageStockRelease(
  tx: Tx,
  lines: readonly StockLine[],
  opts: { outOfStock: boolean },
): Promise<void> {
  for (const line of mergeStockLines(lines)) {
    await releaseStock(tx, line.productId, line.quantity, opts.outOfStock);
  }
}

export async function stageStockCommit(tx: Tx, lines: readonly StockLine[]): Promise<void> {
  for (const line of mergeStockLines(lines)) await commitStock(tx, line.productId, line.quantity);
}

export async function stageStockReturn(tx: Tx, lines: readonly StockLine[]): Promise<void> {
  for (const line of mergeStockLines(lines)) await restockStock(tx, line.productId, line.quantity);
}
