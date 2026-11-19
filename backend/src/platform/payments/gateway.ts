/** The payment gateway of MARKETPLACE §3.8, unchanged (docs/PLATFORM.md §10.4). */
import type { CardBrand } from '@instasupply/shared';

export type AuthorizeResult =
  | { ok: true; intentRef: string; captureBefore: number }
  | { ok: false; reason: 'card_declined' | 'insufficient_funds' | 'expired_card' | 'processing_error' };

export interface PaymentGateway {
  readonly mode: 'test' | 'stripe' | 'disabled';
  authorize(i: {
    idempotencyKey: string;
    amountCents: number;
    customerId: string;
    card: { cardId: string; brand: CardBrand; last4: string };
  }): Promise<AuthorizeResult>;
  capture(i: {
    idempotencyKey: string;
    intentRef: string;
    amountCents: number;
  }): Promise<{ ok: true; ref: string } | { ok: false; reason: string }>;
  void(i: { idempotencyKey: string; intentRef: string }): Promise<void>;
  refund(i: {
    idempotencyKey: string;
    intentRef: string;
    amountCents: number;
    reason: string;
  }): Promise<{ ref: string }>;
  transfer(i: {
    idempotencyKey: string;
    payeeType: 'store' | 'driver';
    accountRef: string;
    amountCents: number;
  }): Promise<{ ref: string }>;
}
