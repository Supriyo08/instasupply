/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `commerce`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** The owner defines the fields (placeOrder, acceptQuote, replacements). */
export interface MarketplaceOrderPlan {
  [field: string]: unknown;
}
export interface StagedOrder {
  orderId: string;
  [field: string]: unknown;
}

export async function stageMarketplaceOrder(_tx: Tx, _plan: MarketplaceOrderPlan): Promise<StagedOrder> {
  return notImplemented('stageMarketplaceOrder');
}
