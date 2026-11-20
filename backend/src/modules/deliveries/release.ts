/**
 * Taking a delivery away from its driver before collection (MARKETPLACE §2.3, §2.4): a driver's decline
 * (`assigned → unassigned`) or release (`accepted → unassigned`), dispatch unassigning, and the release of a
 * suspended driver's jobs (docs/PLATFORM.md §9.2.9). One function, so every path clears the same fields and
 * re-creates the offer by the same rule. Also the small mappers the flows share.
 */
import type { Delivery, DeliveryEventType, StoreOrder } from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { stageJobOffer } from '../jobs/offers';
import { insertEvent, saveDelivery, type EventActorShape } from './repository';

/** The locked store order as the shared document. */
export function storeOrderOf(graph: LockedGraph, id: string | null | undefined): StoreOrder | null {
  if (!id) return null;
  const row = graph.storeOrders.get(id);
  if (!row) return null;
  return {
    ...(row.doc as unknown as Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>),
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The fields a new driver-side flow starts from (assignment, release). */
export const DRIVER_FLOW_RESET = {
  assignedAt: null,
  acceptedAt: null,
  pickedUpAt: null,
  startedAt: null,
  arrivedAt: null,
} as const;

export interface ReleaseOptions {
  /** The driver who declined or released it themselves: added to `declinedBy` and `releasedBy`. */
  byDriverId: string | null;
  eventType: DeliveryEventType;
  message: string;
}

/**
 * The delivery back to `unassigned`, without its driver and the driver's PIN. A marketplace job returns to
 * the board with `opensAt = max(now, offerOpensAt)` (§2.4 re-creation rule), or to `offerStatus: 'held'`
 * while its store order is still `new`. The caller holds the graph (with offers) and runs the effects.
 */
export async function stageRelease(
  tx: Tx,
  graph: LockedGraph,
  delivery: Delivery,
  actor: EventActorShape,
  opts: ReleaseOptions,
): Promise<Delivery> {
  const now = tx.now;
  const marketplace = delivery.kind === 'marketplace';
  const so = storeOrderOf(graph, delivery.storeOrderId);
  let offerStatus = delivery.offerStatus;
  let opensAt: number | null = null;
  if (marketplace) {
    if (!so || so.status === 'new') {
      offerStatus = 'held';
    } else {
      opensAt = Math.max(now, delivery.offerOpensAt ?? now);
      offerStatus = opensAt <= now ? 'open' : 'scheduled';
    }
  }
  const declinedBy = delivery.declinedBy ?? [];
  const next: Delivery = {
    ...delivery,
    ...DRIVER_FLOW_RESET,
    status: 'unassigned',
    driverId: null,
    driverName: null,
    declinedBy:
      opts.byDriverId && !declinedBy.includes(opts.byDriverId)
        ? [...declinedBy, opts.byDriverId]
        : declinedBy,
    releasedBy: opts.byDriverId ? { ...delivery.releasedBy, [opts.byDriverId]: now } : delivery.releasedBy,
    pickup: delivery.pickup ? { ...delivery.pickup, pickupCode: null, arrivedAt: null } : null,
    offerStatus,
    updatedBy: actor.id,
  };
  const saved = await saveDelivery(tx, graph, next);
  await insertEvent(tx, { ...saved, driverId: delivery.driverId }, actor, {
    type: opts.eventType,
    status: 'unassigned',
    fromStatus: delivery.status,
    message: opts.message,
  });
  if (opensAt !== null) await stageJobOffer(tx, saved, { opensAt });
  return saved;
}
