/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `deliveries`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Delivery } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** Was onDeliveryWritten. */
export async function applyDeliveryEffects(
  _tx: Tx,
  _graph: LockedGraph,
  _before: Delivery | null,
  _after: Delivery,
): Promise<void> {
  return notImplemented('applyDeliveryEffects');
}
