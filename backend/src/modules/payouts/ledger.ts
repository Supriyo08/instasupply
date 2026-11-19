/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `money-comms`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Delivery } from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

export async function recordStoreOrderLedger(_tx: Tx, _orderId: string): Promise<void> {
  return notImplemented('recordStoreOrderLedger');
}

export async function recordDeliveryLedger(
  _tx: Tx,
  _before: Delivery | null,
  _after: Delivery,
): Promise<void> {
  return notImplemented('recordDeliveryLedger');
}

export async function recordClawback(
  _tx: Tx,
  _input: {
    issueId: string;
    payeeType: 'store' | 'driver';
    payeeId: string;
    amountCents: number;
    description: string;
  },
): Promise<void> {
  return notImplemented('recordClawback');
}
