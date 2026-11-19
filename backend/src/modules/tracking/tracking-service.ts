/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `routing`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Delivery } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** Writes the fields of the tracking document that delivery transactions own (§9.4). */
export async function syncTracking(_tx: Tx, _delivery: Delivery): Promise<void> {
  return notImplemented('syncTracking');
}
