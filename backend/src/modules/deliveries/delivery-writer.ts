/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `deliveries`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Delivery } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** The owner defines the fields (MARKETPLACE §5.5.1). */
export interface MarketplaceDeliveryInput {
  [field: string]: unknown;
}
/** Who caused a delivery event; the owner defines the fields. */
export interface EventActor {
  [field: string]: unknown;
}

export async function stageMarketplaceDelivery(
  _tx: Tx,
  _input: MarketplaceDeliveryInput,
): Promise<{ deliveryId: string; trackingToken: string }> {
  return notImplemented('stageMarketplaceDelivery');
}

/** Also deletes the offer. */
export async function stageDeliveryCancellation(
  _tx: Tx,
  _graph: LockedGraph,
  _delivery: Delivery,
  _actor: EventActor,
  _reason: string,
): Promise<Delivery> {
  return notImplemented('stageDeliveryCancellation');
}
