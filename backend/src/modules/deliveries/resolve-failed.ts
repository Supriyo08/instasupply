/**
 * `resolveFailedDelivery` (MARKETPLACE §5.4; docs/PLATFORM.md §9.2.8), staff only. The store order must be
 * `failed`. `reattempt`: delivery `failed → picked_up` (`attempts + 1`, optional new window), store order
 * `→ out_for_delivery`. `return_to_store`: delivery `→ cancelled`, store order `→ cancelled`, the fulfilled
 * units back on the shelf, and `current` keeping the fees only for a site-caused failure that is not waived.
 */
import {
  isSiteCausedFailure,
  resolveWindow,
  settleReturnToStore,
  type Delivery,
  type OkResponse,
  type ResolveFailedDeliveryRequest,
  type TimingStore,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { projectOrderAggregate } from '../commerce';
import {
  applyStoreOrderEffects,
  stageStockReturn,
  stageStoreOrderTransition,
  stockLinesOf,
} from '../store-orders';
import { applyDeliveryEffects } from './delivery-effects';
import { eventActorOf } from './delivery-writer';
import { storeOrderOf } from './release';
import { deliveryOf, insertEvent, saveDelivery } from './repository';

interface Keys {
  delivery_id: string | null;
  store_id: string;
  product_ids: string[] | null;
}

/** A new window for the re-attempt, resolved against the store's hours like checkout (§4.4). */
async function newWindow(
  ctx: RequestContext,
  delivery: Delivery,
  storeId: string,
  windowId: string,
): Promise<{ startAt: number | null; endAt: number }> {
  const { rows } = await ctx.deps.pool.query<{ doc: TimingStore }>('SELECT doc FROM stores WHERE id = $1', [
    storeId,
  ]);
  const store = rows[0]?.doc;
  if (!store || !delivery.vehicleClass) invalidArgument('That delivery window is not available.');
  const window = resolveWindow(
    windowId,
    [
      {
        storeId,
        store,
        vehicleClass: delivery.vehicleClass,
        roadTenths: Math.round((delivery.tripKm ?? 0) * 10),
      },
    ],
    ctx.deps.clock.now(),
  );
  if (!window || !window.available) {
    invalidArgument(window?.reason ?? 'That delivery window is not available.', {
      fields: { windowId: 'unavailable' },
    });
  }
  return { startAt: window.startAt, endAt: window.endAt };
}

export async function resolveFailedDelivery(
  ctx: RequestContext,
  actor: Actor,
  req: ResolveFailedDeliveryRequest,
): Promise<OkResponse> {
  const { rows } = await ctx.deps.pool.query<Keys>(
    `SELECT doc->>'deliveryId' AS delivery_id, store_id,
            ARRAY(SELECT line->>'productId' FROM jsonb_array_elements(doc->'lines') AS line
                   WHERE line->>'kind' = 'catalog' AND line->>'productId' IS NOT NULL) AS product_ids
       FROM store_orders WHERE id = $1`,
    [req.storeOrderId],
  );
  const keys = rows[0];
  if (!keys) notFound('That store order does not exist.');
  if (!keys.delivery_id) failedPrecondition('This store order has no delivery to resolve.');

  let window: { startAt: number | null; endAt: number } | null = null;
  if (req.action === 'reattempt' && req.windowId) {
    const current = await ctx.deps.pool.query<{ doc: Omit<Delivery, 'id' | 'createdAt' | 'updatedAt'> }>(
      'SELECT doc FROM deliveries WHERE id = $1',
      [keys.delivery_id],
    );
    const doc = current.rows[0]?.doc;
    if (doc) {
      window = await newWindow(
        ctx,
        { ...doc, id: keys.delivery_id, createdAt: 0, updatedAt: 0 },
        keys.store_id,
        req.windowId,
      );
    }
  }

  await withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, {
      storeOrderIds: [req.storeOrderId],
      withOffers: true,
      productIds: keys.product_ids ?? [],
    });
    const so = storeOrderOf(graph, req.storeOrderId);
    if (!so) notFound('That store order does not exist.');
    if (so.status !== 'failed') failedPrecondition(`${so.number} is not failed.`);
    const delivery = deliveryOf(graph, keys.delivery_id!);
    if (!delivery || delivery.status !== 'failed')
      failedPrecondition('The delivery of this store order is not failed.');

    const who = eventActorOf(actor);
    const orderActor = {
      kind: 'staff' as const,
      uid: actor.uid,
      name: actor.name || null,
      role: actor.role ?? 'dispatcher',
    };
    const note = req.note ?? null;
    let saved: Delivery;
    let after;
    if (req.action === 'reattempt') {
      saved = await saveDelivery(tx, graph, {
        ...delivery,
        status: 'picked_up',
        attempts: delivery.attempts + 1,
        failure: null,
        failedAt: null,
        startedAt: null,
        arrivedAt: null,
        ...(window ? { windowStart: window.startAt, windowEnd: window.endAt } : {}),
        updatedBy: actor.uid,
      });
      await insertEvent(tx, saved, who, {
        type: 'status',
        status: 'picked_up',
        fromStatus: 'failed',
        message: `Re-attempt by dispatch${note ? ` — ${note}` : ''}`,
      });
      after = await stageStoreOrderTransition(tx, graph, so, 'out_for_delivery', orderActor, {
        ...(note ? { note } : {}),
      });
    } else {
      saved = await saveDelivery(tx, graph, {
        ...delivery,
        status: 'cancelled',
        cancelledAt: tx.now,
        offerStatus: delivery.offerStatus,
        updatedBy: actor.uid,
      });
      await insertEvent(tx, saved, who, {
        type: 'status',
        status: 'cancelled',
        fromStatus: 'failed',
        message: `Returned to the store${note ? ` — ${note}` : ''}`,
      });
      const keepFees = isSiteCausedFailure(delivery.failure?.reason) && req.refundDeliveryFee !== true;
      after = await stageStoreOrderTransition(tx, graph, so, 'cancelled', orderActor, {
        reason: 'Returned to the store',
        ...(note ? { note } : {}),
        extra: { current: settleReturnToStore(so.current, keepFees), cancelReason: 'Returned to the store' },
      });
      await stageStockReturn(tx, stockLinesOf(so.lines));
    }
    await applyDeliveryEffects(tx, graph, delivery, saved);
    await applyStoreOrderEffects(tx, graph, so, after);
    await projectOrderAggregate(tx, graph, so.orderId);
  });
  return { ok: true };
}
