/** The Stripe follow-up (PLATFORM §10.4): `loadConfig` refuses PAYMENTS_MODE=stripe until this exists. */
import type { PaymentGateway } from './gateway';

const notImplemented = (): never => {
  throw new Error('StripeGateway is not implemented');
};

export class StripeGateway implements PaymentGateway {
  readonly mode = 'stripe' as const;
  authorize = notImplemented;
  capture = notImplemented;
  void = notImplemented;
  refund = notImplemented;
  transfer = notImplemented;
}
