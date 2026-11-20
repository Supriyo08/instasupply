/**
 * acceptQuote (docs/PLATFORM.md §9.2.10; MARKETPLACE §5.5.6, D16, D17): the customer accepts one offer version and
 * the order is placed through the checkout's own writer at the quoted unit prices. Idempotent like placeOrder:
 * before anything, and again under the locks, an order with id `checkoutId` that is the caller's (or a quote
 * accepted with `orderId = checkoutId`) is the answer. Otherwise the same shape as placeOrder: the context and
 * the card hold before the transaction; users(customer) → quotes → products in it; the void procedure after any
 * failure, which voids only a hold no order owns.
 */
import type { AcceptQuoteRequest, PlaceOrderResponse, Quote, QuoteOffer } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction, type Queryable } from '../../platform/db/tx';
import {
  ApiError,
  failCode,
  failedPrecondition,
  notFound,
  permissionDenied,
} from '../../platform/http/errors';
import {
  loadCheckoutContext,
  stageMarketplaceOrder,
  stagedFromOrder,
  toPlaceOrderResponse,
  type CheckoutContextInput,
  type PlanLine,
} from '../commerce';
import {
  AuthorizationLost,
  OrderAlreadyPlaced,
  authorizeOrderPayment,
  voidOrderAuthorization,
} from '../payments';
import { findQuote, lockQuote, lockUser, readOrder, saveQuote } from './repository';

const MAX_ROUNDS = 3;

/** The order with this checkout id, when it is the caller's; another customer's id is `already-exists`. */
async function existingAnswer(
  db: Queryable,
  orderId: string,
  uid: string,
): Promise<PlaceOrderResponse | null> {
  const order = await readOrder(db, orderId);
  if (!order) return null;
  if (order.customerId !== uid) {
    throw new ApiError('already-exists', 'That checkout id is already in use. Start again.');
  }
  return toPlaceOrderResponse(stagedFromOrder(order, false));
}

/** The checks of §9.2.10 that need no order: owner, accepted elsewhere, status, version, expiry. */
function checkAcceptable(quote: Quote, req: AcceptQuoteRequest, uid: string, now: number): QuoteOffer {
  if (quote.customerId !== uid) permissionDenied();
  if (quote.status === 'accepted') failedPrecondition('This quote was already accepted.');
  const offer = quote.offer;
  if (
    quote.status === 'expired' ||
    (quote.status === 'quoted' && offer !== null && offer.validUntil <= now)
  ) {
    failCode('QUOTE_EXPIRED', 'This quote has expired. Ask for a fresh quote.');
  }
  if (quote.status !== 'quoted' || offer === null) {
    failedPrecondition(`Quote ${quote.number} has no offer to accept.`);
  }
  if (offer.version !== req.version) {
    failCode('QUOTE_VERSION', 'This quote was updated. Check the new offer.', { version: offer.version });
  }
  return offer;
}

/** The quoted lines at the quoted prices; the store is paid the quoted price (D16). */
function planLines(offer: QuoteOffer): PlanLine[] {
  return offer.lines.map((line): PlanLine =>
    line.kind === 'catalog' && line.productId !== null
      ? {
          kind: 'catalog',
          productId: line.productId,
          storeId: line.storeId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          storeUnitPriceCents: line.unitPriceCents,
          note: line.note,
        }
      : {
          kind: 'custom',
          storeId: line.storeId,
          quantity: line.quantity,
          name: line.name,
          unit: line.unit,
          size: line.size,
          categoryId: null,
          unitPriceCents: line.unitPriceCents,
          storeUnitPriceCents: line.unitPriceCents,
          weightKg: line.weightKg,
          dimsCm: line.dimsCm,
          note: line.note,
        },
  );
}

/** The quote was accepted with this very checkout id: its order is the answer. */
async function acceptedHere(db: Queryable, quote: Quote, req: AcceptQuoteRequest, uid: string) {
  if (quote.status === 'accepted' && quote.orderId === req.checkoutId) {
    return existingAnswer(db, req.checkoutId, uid);
  }
  return null;
}

export async function acceptQuote(
  deps: Deps,
  actor: Actor,
  req: AcceptQuoteRequest,
  origin: string,
): Promise<PlaceOrderResponse> {
  const orderId = req.checkoutId;
  const answered = await existingAnswer(deps.pool, orderId, actor.uid);
  if (answered) return answered;

  const quote = await findQuote(deps.pool, req.quoteId);
  if (!quote) notFound('That quote does not exist.');
  if (quote.customerId !== actor.uid) permissionDenied();
  const repeat = await acceptedHere(deps.pool, quote, req, actor.uid);
  if (repeat) return repeat;
  if (deps.config.PAYMENTS_MODE === 'disabled')
    failCode('PAYMENTS_DISABLED', "Card payments aren't available yet.");

  const now = deps.clock.now();
  const offer = checkAcceptable(quote, req, actor.uid, now);
  const delivery = offer.fulfilment === 'delivery';
  const input: CheckoutContextInput = {
    customerId: actor.uid,
    source: 'quote',
    fulfilment: offer.fulfilment,
    jobsiteId: delivery ? (quote.request.jobsite?.jobsiteId ?? null) : null,
    windowId: delivery ? (req.windowId ?? offer.windowId) : null,
    receiving: delivery ? (req.receiving ?? offer.receiving) : null,
    siteContact: req.siteContact,
    instructions: req.instructions,
    unloadHelpStoreIds: delivery ? (req.unloadHelpStoreIds ?? offer.unloadHelpStoreIds) : [],
    promoCode: null,
    lines: planLines(offer),
    expectedTotalCents: req.expectedTotalCents,
    cardId: req.cardId,
    now,
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const context = await loadCheckoutContext(deps, input);
    const card = context.card;
    if (!card) notFound('That card no longer exists. Choose another one.');
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
        const order = await existingAnswer(deps.pool, orderId, actor.uid);
        if (order) return order;
      }
      throw error;
    }

    try {
      return await withTransaction(
        deps,
        async (tx) => {
          // Rank 1 then rank 2 (§3.6): the customer, then the quote; the order writer takes the products.
          await lockUser(tx, actor.uid);
          const locked = await lockQuote(tx, req.quoteId);
          if (!locked) notFound('That quote does not exist.');
          const done =
            (await existingAnswer(tx, orderId, actor.uid)) ??
            (await acceptedHere(tx, locked, req, actor.uid));
          if (done) return done;
          checkAcceptable(locked, req, actor.uid, tx.now);
          const staged = await stageMarketplaceOrder(tx, {
            ...input,
            orderId,
            quoteId: locked.id,
            payment: { kind: 'card', card, ...authorization },
            hstNumber: deps.config.HST_NUMBER || null,
            origin,
          });
          await saveQuote(tx, {
            ...locked,
            status: 'accepted',
            statusAt: { ...locked.statusAt, accepted: tx.now },
            orderId: staged.orderId,
          });
          return toPlaceOrderResponse(staged);
        },
        { now },
      );
    } catch (error) {
      // The void procedure (§10.4) voids only when no order exists and the journal is not attached.
      try {
        await voidOrderAuthorization(deps, orderId);
      } catch (voidError) {
        deps.log.error({ err: voidError, orderId }, 'acceptQuote: the void after a failed acceptance failed');
      }
      if (error instanceof AuthorizationLost) continue;
      throw error;
    }
  }
  throw new ApiError('unavailable', 'Checkout is busy. Please try again.', null, { retryAfterMs: 1000 });
}
