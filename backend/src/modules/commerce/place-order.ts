/**
 * placeOrder (docs/PLATFORM.md §9.2.1; MARKETPLACE §5.5.1). Before the transaction: the idempotency read, the
 * checkout context and the card authorization. The transaction is stageMarketplaceOrder. Any failure after the
 * authorization runs the void procedure, which voids only a hold no order owns.
 */
import type { PlaceOrderRequest, PlaceOrderResponse } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { ApiError, failCode } from '../../platform/http/errors';
import {
  AuthorizationLost,
  OrderAlreadyPlaced,
  authorizeOrderPayment,
  voidOrderAuthorization,
} from '../payments/payment-service';
import type { PlanLine } from './checkout';
import { loadCheckoutContext, type CheckoutContextInput } from './checkout-context';
import { stageMarketplaceOrder, stagedFromOrder, toPlaceOrderResponse } from './order-writer';
import { findOrder } from './orders.repository';

const MAX_ROUNDS = 3;

/** Items merged by product (the schema already refused a product listed under two stores). */
function mergeItems(items: PlaceOrderRequest['items']): PlanLine[] {
  const merged = new Map<string, PlanLine & { kind: 'catalog' }>();
  for (const item of items) {
    const line = merged.get(item.productId);
    if (line) line.quantity += item.quantity;
    else
      merged.set(item.productId, {
        kind: 'catalog',
        productId: item.productId,
        storeId: item.storeId,
        quantity: item.quantity,
      });
  }
  return [...merged.values()];
}

async function existingAnswer(deps: Deps, orderId: string, uid: string): Promise<PlaceOrderResponse | null> {
  const order = await findOrder(deps.pool, orderId);
  if (!order) return null;
  if (order.customerId !== uid) {
    throw new ApiError('already-exists', 'That checkout id is already in use. Start the checkout again.');
  }
  return toPlaceOrderResponse(stagedFromOrder(order, false));
}

export async function placeOrder(
  deps: Deps,
  actor: Actor,
  req: PlaceOrderRequest,
  origin: string,
): Promise<PlaceOrderResponse> {
  if (deps.config.PAYMENTS_MODE === 'disabled')
    failCode('PAYMENTS_DISABLED', "Card payments aren't available yet.");
  const orderId = req.checkoutId;
  const answered = await existingAnswer(deps, orderId, actor.uid);
  if (answered) return answered;

  const now = deps.clock.now();
  const input: CheckoutContextInput = {
    customerId: actor.uid,
    source: 'cart',
    fulfilment: req.fulfilment,
    jobsiteId: req.fulfilment === 'delivery' ? req.jobsiteId : null,
    windowId: req.fulfilment === 'delivery' ? req.windowId : null,
    receiving: req.fulfilment === 'delivery' ? req.receiving : null,
    siteContact: req.siteContact,
    instructions: req.instructions,
    unloadHelpStoreIds: req.fulfilment === 'delivery' ? req.unloadHelpStoreIds : [],
    promoCode: req.promoCode === null || req.promoCode === '' ? null : req.promoCode,
    lines: mergeItems(req.items),
    expectedTotalCents: req.expectedTotalCents,
    cardId: req.cardId,
    now,
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const context = await loadCheckoutContext(deps, input);
    const card = context.card!;
    let authorization;
    try {
      authorization = await authorizeOrderPayment(deps, {
        orderId,
        amountCents: context.totalCents,
        customerId: actor.uid,
        card,
      });
    } catch (error) {
      if (error instanceof OrderAlreadyPlaced) {
        const order = await existingAnswer(deps, orderId, actor.uid);
        if (order) return order;
      }
      throw error;
    }
    await deps.hooks.at('placeOrder:afterAuthorize');

    try {
      const staged = await withTransaction(
        deps,
        (tx) =>
          stageMarketplaceOrder(tx, {
            ...input,
            orderId,
            payment: { kind: 'card', card, ...authorization },
            hstNumber: deps.config.HST_NUMBER || null,
            origin,
            onLocked: () => deps.hooks.at('placeOrder:locked'),
          }),
        { now },
      );
      return toPlaceOrderResponse(staged);
    } catch (error) {
      // Voids only when no order exists and the journal is not attached (§10.4): a concurrent call with the
      // same checkoutId may own this very hold. A failed void stays void_pending for the sweep.
      try {
        await voidOrderAuthorization(deps, orderId);
      } catch (voidError) {
        deps.log.error({ err: voidError, orderId }, 'placeOrder: the void after a failed checkout failed');
      }
      if (error instanceof AuthorizationLost) continue;
      throw error;
    }
  }
  throw new ApiError('unavailable', 'Checkout is busy. Please try again.', null, { retryAfterMs: 1000 });
}
