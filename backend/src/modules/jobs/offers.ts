/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `deliveries`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Delivery } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

export async function stageJobOffer(_tx: Tx, _delivery: Delivery, _opts: { opensAt: number }): Promise<void> {
  return notImplemented('stageJobOffer');
}

export async function deleteJobOffer(_tx: Tx, _deliveryId: string): Promise<void> {
  return notImplemented('deleteJobOffer');
}
