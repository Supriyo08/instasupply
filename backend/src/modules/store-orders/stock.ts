/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `store-orders`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** One product quantity; the owner may extend it. */
export interface StockLine {
  productId: string;
  quantity: number;
}

export async function stageStockReserve(_tx: Tx, _lines: readonly StockLine[]): Promise<void> {
  return notImplemented('stageStockReserve');
}
export async function stageStockRelease(
  _tx: Tx,
  _lines: readonly StockLine[],
  _opts: { outOfStock: boolean },
): Promise<void> {
  return notImplemented('stageStockRelease');
}
export async function stageStockCommit(_tx: Tx, _lines: readonly StockLine[]): Promise<void> {
  return notImplemented('stageStockCommit');
}
export async function stageStockReturn(_tx: Tx, _lines: readonly StockLine[]): Promise<void> {
  return notImplemented('stageStockReturn');
}
