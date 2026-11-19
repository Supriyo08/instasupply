/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `store-orders`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** New 4-digit PIN, attempts reset. */
export async function stagePickupCode(
  _tx: Tx,
  _storeOrderId: string,
  _issuedTo: 'customer' | string,
): Promise<string> {
  return notImplemented('stagePickupCode');
}
