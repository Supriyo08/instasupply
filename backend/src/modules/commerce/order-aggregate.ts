/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `commerce`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Order } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { notImplemented } from '../../platform/http/errors';

/** Was syncOrderAggregate (MARKETPLACE §5.5.5); called inside every transaction that changes a store order. */
export async function projectOrderAggregate(_tx: Tx, _graph: LockedGraph, _orderId: string): Promise<Order> {
  return notImplemented('projectOrderAggregate');
}
