/**
 * `completePickup` (MARKETPLACE §5.5.2 → docs/PLATFORM.md §9.2.4): the store types the driver's or the
 * customer's PIN. Checks, in this order: access; `expectedVersion`; adjustments; status `ready`; for a delivery,
 * the delivery `accepted` with a driver and the PIN issued to that driver (`DRIVER_NOT_ASSIGNED`); the PIN,
 * unless staff give an `overrideReason`. A wrong PIN commits only `meta.codeAttempts + 1`, then the handler
 * answers `CODE_INCORRECT { remaining }`. The right PIN moves the store order, the delivery (with wait pay)
 * and the stock in one transaction.
 */
import { timingSafeEqual } from 'node:crypto';
import {
  canStoreOrderTransition,
  type CompletePickupRequest,
  type CompletePickupResponse,
  type Delivery,
  type StoreOrder,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import type { LockedGraph } from '../../platform/db/locks';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failCode, failedPrecondition, invalidArgument, permissionDenied } from '../../platform/http/errors';
import { projectOrderAggregate } from '../commerce/order-aggregate';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { orderActorFrom } from './access';
import { checkVersion, keysForAction, lockStoreOrder, refreshDelivery } from './command-support';
import { MAX_PICKUP_CODE_ATTEMPTS } from './pickup-code';
import { stageStockCommit, stockLinesOf } from './stock';
import { applyStoreOrderEffects } from './store-order-effects';
import {
  insertDeliveryEvent,
  patchMeta,
  readMeta,
  saveDelivery,
  toDelivery,
} from './store-orders.repository';
import {
  adjustmentsEmptyOrder,
  resolveActor,
  stageStoreOrderTransition,
  validateAdjustments,
} from './transitions';

const MINUTE_MS = 60_000;
const WAIT_GRACE_MIN = 15;
const WAIT_CENTS_PER_MIN = 25;
const WAIT_MAX_CENTS = 1_500;

/** MARKETPLACE §3.10: 25¢ a minute after a 15-minute grace, at most $15, counted from max(arrivedAt, readyBy). */
export function waitCents(pickup: NonNullable<Delivery['pickup']>, collectedAt: number): number {
  if (pickup.arrivedAt === null) return 0;
  const from = Math.max(pickup.arrivedAt, pickup.readyBy);
  const minutes = Math.floor((collectedAt - from) / MINUTE_MS);
  return Math.min(WAIT_MAX_CENTS, WAIT_CENTS_PER_MIN * Math.max(0, minutes - WAIT_GRACE_MIN));
}

function samePin(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

type Outcome = { ok: true; status: CompletePickupResponse['status'] } | { ok: false; remaining: number };

export async function completePickup(
  deps: Deps,
  actor: Actor,
  req: CompletePickupRequest,
): Promise<CompletePickupResponse> {
  const override = req.overrideReason?.trim() || null;
  if (override && !actor.isStaff)
    permissionDenied('Only InstaSupply staff can complete a pickup without the PIN.');
  if (!override && req.pickupCode === null) {
    invalidArgument('Enter the 4-digit pickup PIN.', { fields: { pickupCode: 'required' } });
  }
  const keys = await keysForAction(deps, actor, req.storeOrderId);
  const who = orderActorFrom(actor);

  const outcome = await withTransaction<Outcome>(deps, async (tx) => {
    const { graph, so } = await lockStoreOrder(tx, keys, { withOffers: false });
    await deps.hooks.at('completePickup:locked');
    checkVersion(so, req.expectedVersion);
    validateAdjustments(so, req.adjustments);
    if (so.status !== 'ready') failCode('STORE_NOT_READY', `${so.number} isn't marked ready yet.`);
    if (adjustmentsEmptyOrder(so, req.adjustments)) {
      failedPrecondition(`Nothing is left to hand over on ${so.number}. Cancel the order instead.`);
    }
    const to = so.fulfilment === 'delivery' ? 'out_for_delivery' : 'picked_up';
    if (!canStoreOrderTransition(so.status, to, resolveActor(who).kind, { fulfilment: so.fulfilment })) {
      failedPrecondition(`${so.number} can't be handed over now.`, { status: so.status });
    }

    const meta = (await readMeta(tx, so.id))!;
    let delivery: Delivery | null = null;
    if (so.fulfilment === 'delivery') {
      const row = so.deliveryId ? graph.deliveries.get(so.deliveryId) : undefined;
      delivery = row ? toDelivery(row) : null;
      if (!delivery || delivery.status !== 'accepted' || !delivery.driverId) {
        failCode('DRIVER_NOT_ASSIGNED', driverMissingText(delivery));
      }
      if (!override && meta.pickupCodeIssuedTo !== delivery.driverId) {
        failCode('DRIVER_NOT_ASSIGNED', driverMissingText(null));
      }
    } else if (!override && meta.pickupCodeIssuedTo !== 'customer') {
      failedPrecondition(`${so.number} has no pickup PIN. Ask InstaSupply support.`);
    }

    if (!override) {
      if (meta.codeAttempts >= MAX_PICKUP_CODE_ATTEMPTS) {
        failCode('CODE_LOCKED', 'Too many wrong PINs. Call InstaSupply support to complete this pickup.');
      }
      if (!meta.pickupCode || !samePin(meta.pickupCode, req.pickupCode ?? '')) {
        // Only the attempt is saved: no version bump, no adjustment (§9.2.4).
        const attempts = meta.codeAttempts + 1;
        await patchMeta(tx, so.id, { codeAttempts: attempts });
        return { ok: false, remaining: Math.max(0, MAX_PICKUP_CODE_ATTEMPTS - attempts) };
      }
    }

    await handOver(tx, graph, so, delivery, actor, who, override, req);
    return { ok: true, status: to };
  });

  if (!outcome.ok) {
    // The fifth wrong PIN still answers CODE_INCORRECT { remaining: 0 }; the next try is CODE_LOCKED.
    failCode('CODE_INCORRECT', `That PIN is not right. ${outcome.remaining} tries left.`, {
      remaining: outcome.remaining,
    });
  }
  return { status: outcome.status };
}

function driverMissingText(delivery: Delivery | null): string {
  const name = delivery?.driverName?.trim().split(/\s+/)[0];
  return name ? `${name} hasn't accepted the job yet.` : "The driver hasn't accepted the job yet.";
}

async function handOver(
  tx: Tx,
  graph: LockedGraph,
  so: StoreOrder,
  delivery: Delivery | null,
  actor: Actor,
  who: ReturnType<typeof orderActorFrom>,
  override: string | null,
  req: CompletePickupRequest,
): Promise<void> {
  const now = tx.now;
  const to = so.fulfilment === 'delivery' ? 'out_for_delivery' : 'picked_up';
  const after = await stageStoreOrderTransition(tx, graph, so, to, who, {
    adjustments: req.adjustments,
    note: override ? `Completed without the PIN: ${override}` : undefined,
    extra: {
      pickup: {
        ...so.pickup,
        collectedAt: now,
        collectedBy: so.fulfilment === 'delivery' ? 'driver' : 'customer',
      },
    },
  });
  await patchMeta(tx, so.id, { codeAttempts: 0 });
  await stageStockCommit(tx, stockLinesOf(after.lines));
  await applyStoreOrderEffects(tx, graph, so, after);

  if (delivery && delivery.pickup) {
    const wait = waitCents(delivery.pickup, now);
    const payout = delivery.payout
      ? {
          ...delivery.payout,
          waitCents: wait,
          totalCents: delivery.payout.offerCents + delivery.payout.boostCents + wait,
        }
      : null;
    const moved = await saveDelivery(tx, {
      ...delivery,
      status: 'picked_up',
      pickedUpAt: now,
      pickup: { ...delivery.pickup, collectedAt: now },
      payout,
      updatedBy: actor.uid,
    });
    refreshDelivery(graph, moved);
    const by = actor.isStaff
      ? `${actor.name || 'InstaSupply staff'} (staff${override ? `: ${override}` : ''})`
      : actor.name || 'the store';
    await insertDeliveryEvent(tx, {
      deliveryId: delivery.id,
      orderId: delivery.orderId,
      driverId: delivery.driverId,
      type: 'status',
      status: 'picked_up',
      fromStatus: delivery.status,
      message: `Collected at ${delivery.pickup.storeName} — ${override ? 'completed' : 'PIN checked'} by ${by}`,
      actorId: actor.uid,
      actorName: actor.name || null,
      actorRole: resolveActor(who).role,
      location: null,
    });
    await applyDeliveryEffects(tx, graph, delivery, moved);
  }
  await projectOrderAggregate(tx, graph, so.orderId);
}
