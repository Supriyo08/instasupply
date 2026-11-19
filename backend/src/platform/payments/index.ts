/** createGateway by PAYMENTS_MODE (docs/PLATFORM.md §10.4). */
import type { Config } from '../../config/env';
import { failCode } from '../http/errors';
import type { PaymentGateway } from './gateway';
import { StripeGateway } from './stripe-gateway';
import { TestGateway } from './test-gateway';

export type { PaymentGateway } from './gateway';
export { TestGateway } from './test-gateway';

const disabled = (): never => failCode('PAYMENTS_DISABLED', "Card payments aren't available yet.");

/** PAYMENTS_MODE=disabled: every call fails with PAYMENTS_DISABLED, so no caller needs a null check. */
export class DisabledGateway implements PaymentGateway {
  readonly mode = 'disabled' as const;
  authorize = disabled;
  capture = disabled;
  void = disabled;
  refund = disabled;
  transfer = disabled;
}

export function createGateway(
  config: Pick<Config, 'PAYMENTS_MODE'>,
  clock: { now(): number },
): PaymentGateway {
  switch (config.PAYMENTS_MODE) {
    case 'test':
      return new TestGateway(clock);
    case 'stripe':
      return new StripeGateway();
    case 'disabled':
      return new DisabledGateway();
  }
}
