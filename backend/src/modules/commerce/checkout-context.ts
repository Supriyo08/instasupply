/**
 * loadCheckoutContext (docs/PLATFORM.md §9.1, §9.2.1 step 3): the reads and checks of a checkout before the
 * card is authorized, on plain reads outside any transaction. The same rules run again under lock in
 * stageMarketplaceOrder; this pass exists so a decline, a price change or an empty shelf costs no hold.
 */
import { isFutureExpiry, type CardBrand } from '@instasupply/shared';
import type { Deps } from '../../container';
import { failCode, notFound, permissionDenied } from '../../platform/http/errors';
import {
  catalogProductIds,
  evaluateCheckout,
  isInsideServiceArea,
  storeIdsOf,
  type CheckoutRequest,
  type EvaluatedCheckout,
} from './checkout';
import {
  readCard,
  readCustomer,
  readJobsite,
  readProducts,
  readStores,
  type CustomerRecord,
} from './orders.repository';

/** What a checkout asks for, plus the card that will pay (none for a replacement). */
export interface CheckoutContextInput extends CheckoutRequest {
  cardId: string | null;
  /** The command's clock value. */
  now: number;
}

export interface CheckoutContext extends EvaluatedCheckout {
  customer: CustomerRecord;
  card: { cardId: string; brand: CardBrand; last4: string } | null;
  totalCents: number;
}

/** Reads, outside the transaction. */
export async function loadCheckoutContext(deps: Deps, input: CheckoutContextInput): Promise<CheckoutContext> {
  const { pool, config } = deps;
  const customer = await readCustomer(pool, input.customerId);
  if (!customer || customer.role !== 'customer')
    permissionDenied('Sign in with a customer account to do this.');
  if (input.source !== 'replacement' && config.PHONE_VERIFICATION === 'required' && !customer.phoneVerified) {
    failCode('PHONE_UNVERIFIED', 'Verify your phone number before you place an order.');
  }

  let jobsite = null;
  if (input.fulfilment === 'delivery' && input.jobsiteId !== null) {
    jobsite = await readJobsite(pool, input.jobsiteId);
    if (!jobsite || jobsite.userId !== customer.id)
      notFound('That jobsite no longer exists. Choose another one.');
    if (!isInsideServiceArea(jobsite.fields.location)) {
      failCode('OUTSIDE_SERVICE_AREA', 'That jobsite is outside the area we deliver to.');
    }
  }

  let card: CheckoutContext['card'] = null;
  if (input.cardId !== null) {
    const saved = await readCard(pool, input.cardId);
    if (!saved || saved.userId !== customer.id) notFound('That card no longer exists. Choose another one.');
    if (!isFutureExpiry(saved.expMonth, saved.expYear, input.now)) {
      failCode('CARD_DECLINED', 'That card has expired. Choose another one.', { reason: 'expired_card' });
    }
    card = { cardId: saved.id, brand: saved.brand, last4: saved.last4 };
  }

  const [stores, products] = await Promise.all([
    readStores(pool, storeIdsOf(input.lines)),
    readProducts(pool, catalogProductIds(input.lines)),
  ]);
  const evaluated = evaluateCheckout(input, { customer, jobsite, stores, products, now: input.now });
  return { ...evaluated, customer, card, totalCents: evaluated.priced.totalCents };
}
