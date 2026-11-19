/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `store-orders`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { StoreOrder } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** Was onStoreOrderWritten. */
export async function applyStoreOrderEffects(
  _tx: Tx,
  _graph: LockedGraph,
  _before: StoreOrder | null,
  _after: StoreOrder,
): Promise<void> {
  return notImplemented('applyStoreOrderEffects');
}
