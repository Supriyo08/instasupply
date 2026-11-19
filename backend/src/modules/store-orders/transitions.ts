/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `store-orders`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { LineAdjustment, StoreOrder, StoreOrderStatus } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** Who changed a store order; the owner defines the fields (MARKETPLACE §2.1). */
export interface OrderActor {
  [field: string]: unknown;
}

export async function stageStoreOrderTransition(
  _tx: Tx,
  _graph: LockedGraph,
  _so: StoreOrder,
  _to: StoreOrderStatus,
  _actor: OrderActor,
  _opts?: { adjustments?: LineAdjustment[]; reason?: string; note?: string; extra?: Partial<StoreOrder> },
): Promise<StoreOrder> {
  return notImplemented('stageStoreOrderTransition');
}
