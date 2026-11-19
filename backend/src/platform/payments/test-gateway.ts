/**
 * Deterministic by the card's last 4 (MARKETPLACE §3.8): 0002 declined, 9995 insufficient funds, 0069
 * expired, 0341 authorizes and then fails every capture, anything else succeeds. No network.
 */
import type { PaymentGateway } from './gateway';

const DAY_MS = 86_400_000;

/** `auth_{orderId}` → orderId; any other key is used as is. */
const subject = (key: string, prefix: string): string =>
  key.startsWith(prefix) ? key.slice(prefix.length) : key;

export class TestGateway implements PaymentGateway {
  readonly mode = 'test' as const;
  /** Which intents belong to the capture-failing card. In memory: a restart forgets it, which only matters for 0341. */
  private readonly failingCaptures = new Set<string>();

  constructor(private readonly clock: { now(): number }) {}

  async authorize(i: Parameters<PaymentGateway['authorize']>[0]) {
    switch (i.card.last4) {
      case '0002':
        return { ok: false as const, reason: 'card_declined' as const };
      case '9995':
        return { ok: false as const, reason: 'insufficient_funds' as const };
      case '0069':
        return { ok: false as const, reason: 'expired_card' as const };
      default: {
        // The intent is named after the order, so a retried key (attempt r2) still names the same order.
        const orderId = subject(i.idempotencyKey, 'auth_').replace(/_r\d+$/, '');
        const intentRef = `test_pi_${orderId}`;
        if (i.card.last4 === '0341') this.failingCaptures.add(intentRef);
        return { ok: true as const, intentRef, captureBefore: this.clock.now() + 7 * DAY_MS };
      }
    }
  }

  async capture(i: Parameters<PaymentGateway['capture']>[0]) {
    if (this.failingCaptures.has(i.intentRef)) return { ok: false as const, reason: 'processing_error' };
    return { ok: true as const, ref: `test_ch_${i.intentRef.replace(/^test_pi_/, '')}` };
  }

  async void(): Promise<void> {}

  async refund(i: Parameters<PaymentGateway['refund']>[0]) {
    return { ref: `test_re_${i.idempotencyKey}` };
  }

  async transfer(i: Parameters<PaymentGateway['transfer']>[0]) {
    return { ref: `test_tr_${subject(i.idempotencyKey, 'payout_')}` };
  }
}
