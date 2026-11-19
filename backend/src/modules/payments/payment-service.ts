/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `commerce`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { CardBrand } from '@instasupply/shared';
import type { Deps } from '../../container';
import { notImplemented } from '../../platform/http/errors';

/** Journal + gateway, outside the transaction; throws CARD_DECLINED. */
export async function authorizeOrderPayment(
  _deps: Deps,
  _input: {
    orderId: string;
    amountCents: number;
    customerId: string;
    card: { cardId: string; brand: CardBrand; last4: string };
  },
): Promise<{ intentRef: string; captureBefore: number }> {
  return notImplemented('authorizeOrderPayment');
}

/** Only when orders/{orderId} does not exist. */
export async function voidOrderAuthorization(_deps: Deps, _orderId: string): Promise<void> {
  return notImplemented('voidOrderAuthorization');
}

/** The body of the payment.finalize handler. */
export async function finalizeOrderPayment(
  _deps: Deps,
  _orderId: string,
  _opts?: { deadline?: boolean },
): Promise<void> {
  return notImplemented('finalizeOrderPayment');
}

/** The body of payment.refund. */
export async function refundOrderPayment(
  _deps: Deps,
  _input: {
    orderId: string;
    storeOrderId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    issueId: string | null;
  },
): Promise<{ ref: string }> {
  return notImplemented('refundOrderPayment');
}
