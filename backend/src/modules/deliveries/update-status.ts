/**
 * `updateDeliveryStatus` and `completeDelivery` (MARKETPLACE §2.3, §5.5.4; docs/PLATFORM.md §9.2.6). Port of
 * legacy/…/deliveries/update-status.ts on PostgreSQL: one transaction locks users → orders → store orders →
 * deliveries (the target and the trips it parks) → offers, enforces the shared machine and the marketplace
 * rules, couples the store order (failed, delivered) and runs the effects.
 */
import {
  DECLINE_REASONS,
  STATUS_TIMESTAMP_FIELD,
  canTransition,
  declineReasonLabel,
  failureReasonLabel,
  requiresPickup,
  statusLabel,
  type CompleteDeliveryRequest,
  type Delivery,
  type DeliveryStatus,
  type OkResponse,
  type StoreOrder,
  type StoreOrderStatus,
  type UpdateDeliveryStatusRequest,
  type UpdateDeliveryStatusResponse,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph, type LockedGraph } from '../../platform/db/locks';
import { RetryTransaction, withTransaction, type Tx } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import {
  ApiError,
  failCode,
  failedPrecondition,
  invalidArgument,
  notFound,
  permissionDenied,
} from '../../platform/http/errors';
import { requireReadyFile } from '../../platform/storage/files.service';
import { projectOrderAggregate } from '../commerce';
import { applyStoreOrderEffects, stageStoreOrderTransition } from '../store-orders';
import { canReadDelivery } from './access';
import { applyDeliveryEffects } from './delivery-effects';
import { SYSTEM_ACTOR, eventActorOf } from './delivery-writer';
import { stageRelease, storeOrderOf } from './release';
import {
  deliveryOf,
  findDeliveryKeys,
  insertEvent,
  metaOf,
  movingDeliveryIds,
  patchMeta,
  saveDelivery,
} from './repository';

export const MAX_CODE_ATTEMPTS = 5;

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** The store-order actor of a delivery transition (the coupling rows of MARKETPLACE §2.1). */
const orderActorOf = (actor: Actor) => ({
  kind: actor.isStaff ? ('staff' as const) : ('driver' as const),
  uid: actor.uid,
  name: actor.name || null,
  role: actor.role ?? 'driver',
});

function describe(
  to: DeliveryStatus,
  isDecline: boolean,
  released: boolean,
  note: string | null,
  reason: string | null,
) {
  const suffix = note ? ` — ${note}` : '';
  switch (to) {
    case 'accepted':
      return 'Driver accepted the delivery';
    case 'picked_up':
      return 'Package picked up';
    case 'in_transit':
      return 'Driver is on the way';
    case 'arrived':
      return 'Driver arrived at the drop-off';
    case 'unassigned':
      if (released) return `Released by driver: ${declineReasonLabel(reason)}${suffix}`;
      return isDecline
        ? `Declined by driver: ${declineReasonLabel(reason)}${suffix}`
        : `Unassigned by dispatch${suffix}`;
    case 'failed':
      return `Delivery failed: ${failureReasonLabel(reason)}${suffix}`;
    case 'cancelled':
      return `Cancelled by dispatch${suffix}`;
    case 'delivered':
      return `Marked as delivered by dispatch${suffix}`;
    default:
      return `Status changed to ${statusLabel(to)}${suffix}`;
  }
}

/** Store order coupling: `failed` and `delivered` move the store order in the same transaction. */
async function coupleStoreOrder(
  tx: Tx,
  graph: LockedGraph,
  delivery: Delivery,
  to: StoreOrderStatus,
  actor: Actor,
  note: string | null,
): Promise<{ before: StoreOrder; after: StoreOrder } | null> {
  const before = storeOrderOf(graph, delivery.storeOrderId);
  if (!before || before.status === to) return null;
  const after = await stageStoreOrderTransition(tx, graph, before, to, orderActorOf(actor), {
    ...(note ? { note } : {}),
  });
  return { before, after };
}

export async function updateDeliveryStatus(
  ctx: RequestContext,
  actor: Actor,
  req: UpdateDeliveryStatusRequest,
): Promise<UpdateDeliveryStatusResponse> {
  const to = req.status;
  if (to === 'assigned') invalidArgument('Use assignDelivery to assign a driver.');
  if (to === 'failed' && !req.failureReason) invalidArgument('Choose why the delivery failed.');
  const keys = await findDeliveryKeys(ctx.deps.pool, req.deliveryId);
  if (!keys) notFound('This delivery no longer exists.');
  if (!actor.isStaff && keys.driver_id !== actor.uid)
    permissionDenied('This delivery is not assigned to you.');
  const kind = actor.isStaff ? 'staff' : 'driver';
  const note = req.note ?? null;

  const parks = kind === 'driver' && to === 'in_transit';

  return withTransaction(ctx.deps, async (tx) => {
    // A driver starting a trip parks the other one that is on the way: read before the locks (on every
    // attempt, so a retry sees what the other device committed) and checked again under them.
    const movingBefore = parks
      ? (await movingDeliveryIds(tx, actor.uid)).filter((id) => id !== req.deliveryId)
      : [];
    const graph = await lockGraph(tx, {
      deliveryIds: [req.deliveryId, ...movingBefore],
      userIds: kind === 'driver' ? [actor.uid] : [],
      withOffers: true,
    });
    if (parks) {
      const moving = (await movingDeliveryIds(tx, actor.uid)).filter((id) => id !== req.deliveryId);
      if (!sameSet(moving, movingBefore)) throw new RetryTransaction();
    }
    const delivery = deliveryOf(graph, req.deliveryId);
    if (!delivery) notFound('This delivery no longer exists.');
    if (!canReadDelivery(actor, delivery)) permissionDenied('This delivery is not assigned to you.');
    if (delivery.status === to) return { status: to };

    const marketplace = delivery.kind === 'marketplace';
    const uncollected = requiresPickup(delivery);
    if (!canTransition(delivery.status, to, kind, { requiresPickup: uncollected })) {
      failedPrecondition(
        `A delivery can't go from "${statusLabel(delivery.status)}" to "${statusLabel(to)}".`,
      );
    }
    if (kind === 'driver' && to === 'delivered') {
      failedPrecondition('Complete the delivery with proof of delivery.');
    }
    if (kind === 'staff' && marketplace) {
      if (to === 'picked_up') {
        failedPrecondition(
          'Confirm the collection with the store (completePickup), with an override if needed.',
        );
      }
      if (to === 'cancelled') failedPrecondition('Cancel the store order instead: its delivery follows.');
      if (delivery.status === 'failed')
        failedPrecondition('Resolve a failed delivery with resolveFailedDelivery.');
      if (to === 'unassigned' && !uncollected) {
        failedPrecondition('A collected delivery cannot be unassigned.');
      }
    }

    const isDecline = kind === 'driver' && delivery.status === 'assigned' && to === 'unassigned';
    const isRelease = kind === 'driver' && delivery.status === 'accepted' && to === 'unassigned';
    if ((isDecline || isRelease) && !DECLINE_REASONS.some((reason) => reason.id === req.declineReason)) {
      invalidArgument(isRelease ? 'Choose why you are releasing this job.' : 'Choose why you are declining.');
    }
    const who = eventActorOf(actor);
    const location = req.location ?? null;
    const reason = isDecline || isRelease ? (req.declineReason ?? null) : (req.failureReason ?? null);

    let saved: Delivery;
    if (to === 'unassigned') {
      saved = await stageRelease(tx, graph, delivery, who, {
        byDriverId: isDecline || isRelease ? actor.uid : null,
        eventType: isDecline || isRelease ? 'status' : 'unassigned',
        message: describe(to, isDecline, isRelease, note, reason),
      });
    } else {
      const next: Delivery = { ...delivery, status: to, updatedBy: actor.uid };
      const field = STATUS_TIMESTAMP_FIELD[to];
      if (field) (next as unknown as Record<string, unknown>)[field] = tx.now;
      if (to === 'failed') next.failure = { reason: req.failureReason!, note };
      if (to === 'delivered') {
        next.proof = {
          recipientName: null,
          photoPath: null,
          codeVerified: false,
          note: note ?? 'Marked as delivered by dispatch',
          location: null,
        };
      }
      if (to === 'picked_up' && delivery.status === 'failed') {
        // A staff re-attempt of a manual delivery: the goods are still on the truck.
        next.attempts = delivery.attempts + 1;
        next.failure = null;
        next.failedAt = null;
      }
      saved = await saveDelivery(tx, graph, next);
      await insertEvent(tx, saved, who, {
        type: 'status',
        status: to,
        fromStatus: delivery.status,
        message: describe(to, false, false, note, reason),
        location,
      });
    }

    // Parked trips: only one stop is "on the way" at a time.
    const parked: { before: Delivery; after: Delivery }[] = [];
    for (const id of movingBefore) {
      const other = deliveryOf(graph, id);
      if (!other || (other.status !== 'in_transit' && other.status !== 'arrived')) continue;
      const after = await saveDelivery(tx, graph, { ...other, status: 'picked_up', updatedBy: actor.uid });
      await insertEvent(tx, after, SYSTEM_ACTOR, {
        type: 'status',
        status: 'picked_up',
        fromStatus: other.status,
        message: 'Trip paused — the driver started another stop',
      });
      parked.push({ before: other, after });
    }

    const coupled =
      to === 'failed' || to === 'delivered'
        ? await coupleStoreOrder(tx, graph, saved, to, actor, note)
        : null;
    await applyDeliveryEffects(tx, graph, delivery, saved);
    for (const trip of parked) await applyDeliveryEffects(tx, graph, trip.before, trip.after);
    if (coupled) {
      await applyStoreOrderEffects(tx, graph, coupled.before, coupled.after);
      await projectOrderAggregate(tx, graph, coupled.after.orderId);
    }
    return { status: to };
  });
}

type CompleteOutcome = { ok: true } | { error: 'wrong_code'; remaining: number };

export async function completeDelivery(
  ctx: RequestContext,
  actor: Actor,
  req: CompleteDeliveryRequest,
): Promise<OkResponse> {
  const keys = await findDeliveryKeys(ctx.deps.pool, req.deliveryId);
  if (!keys) notFound('This delivery no longer exists.');
  if (!actor.isStaff && keys.driver_id !== actor.uid)
    permissionDenied('This delivery is not assigned to you.');
  const kind = actor.isStaff ? 'staff' : 'driver';
  const recipientName = req.recipientName ?? null;
  const code = typeof req.handoffCode === 'string' ? req.handoffCode.replace(/\D/g, '') : '';
  const note = req.note ?? null;
  const location = req.location ?? null;

  // The proof photo is a confirmed `proof` upload of this delivery (by this driver), checked before the
  // transaction (§10.1). A marketplace delivery completed by its driver needs one.
  const photoPath = req.photoPath ?? null;
  const photoRequired = kind === 'driver' && keys.kind === 'marketplace';
  if (photoRequired && !photoPath)
    failCode('PHOTO_REQUIRED', 'Add a drop-off photo to complete the delivery.');
  if (photoPath) {
    try {
      await requireReadyFile(ctx.deps.pool, photoPath, {
        purpose: 'proof',
        scopeId: req.deliveryId,
        ...(kind === 'driver' ? { uploadedBy: actor.uid } : {}),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 'invalid-argument') {
        failCode('PHOTO_REQUIRED', 'The proof photo is invalid. Please retake it.');
      }
      throw error;
    }
  }

  const outcome = await withTransaction<CompleteOutcome>(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, {
      deliveryIds: [req.deliveryId],
      userIds: kind === 'driver' ? [actor.uid] : [],
      withOffers: true,
    });
    const delivery = deliveryOf(graph, req.deliveryId);
    const row = graph.deliveries.get(req.deliveryId);
    if (!delivery || !row) notFound('This delivery no longer exists.');
    if (!canReadDelivery(actor, delivery)) permissionDenied('This delivery is not assigned to you.');
    if (delivery.status === 'delivered') return { ok: true };
    if (!canTransition(delivery.status, 'delivered', kind, { requiresPickup: requiresPickup(delivery) })) {
      failedPrecondition(`This delivery can't be completed while it is "${statusLabel(delivery.status)}".`);
    }
    if (kind === 'driver' && !recipientName && !photoPath) {
      invalidArgument("Add the recipient's name or a photo as proof of delivery.");
    }

    let codeVerified = false;
    if (delivery.requireCode && kind === 'driver') {
      const meta = metaOf(row);
      if (meta.codeAttempts >= MAX_CODE_ATTEMPTS) {
        failCode('CODE_LOCKED', 'Too many incorrect codes. Ask dispatch to complete this delivery.');
      }
      if (!code || code !== meta.handoffCode) {
        // Only the attempt is committed; the answer is CODE_INCORRECT after the commit.
        await patchMeta(tx, delivery.id, { codeAttempts: meta.codeAttempts + 1 });
        return { error: 'wrong_code', remaining: MAX_CODE_ATTEMPTS - meta.codeAttempts - 1 };
      }
      codeVerified = true;
      await patchMeta(tx, delivery.id, { codeAttempts: 0 });
    }

    const next: Delivery = {
      ...delivery,
      status: 'delivered',
      deliveredAt: tx.now,
      proof: { recipientName, photoPath, codeVerified, note, location },
      updatedBy: actor.uid,
    };
    const saved = await saveDelivery(tx, graph, next);
    const details = [
      recipientName ? `to ${recipientName}` : null,
      codeVerified ? 'code verified' : null,
    ].filter((part): part is string => part !== null);
    await insertEvent(tx, saved, eventActorOf(actor), {
      type: 'status',
      status: 'delivered',
      fromStatus: delivery.status,
      message: `Delivered${details.length ? ` (${details.join(', ')})` : ''}`,
      location,
    });
    const coupled = await coupleStoreOrder(tx, graph, saved, 'delivered', actor, null);
    await applyDeliveryEffects(tx, graph, delivery, saved);
    if (coupled) {
      await applyStoreOrderEffects(tx, graph, coupled.before, coupled.after);
      await projectOrderAggregate(tx, graph, coupled.after.orderId);
    }
    return { ok: true };
  });

  if ('error' in outcome) {
    failCode(
      'CODE_INCORRECT',
      `That hand-off code is incorrect. ${outcome.remaining} attempt${outcome.remaining === 1 ? '' : 's'} left.`,
      { remaining: outcome.remaining },
    );
  }
  return { ok: true };
}
