/**
 * The `payout.transfer` outbox handler (docs/PLATFORM.md §9.3): `gateway.transfer` with the key
 * `payout_{payoutId}`, then the payout becomes `paid` with the reference and the payee is told
 * (`payout_sent`: the store's owners, or the driver). It acts only while the payout is `pending`, so a second
 * run changes nothing, and the gateway key makes a repeated transfer return the first one.
 *
 * A definite refusal (the gateway throws an ApiError with status `failed-precondition`, or an error marked
 * `refused: true`) marks the payout `failed`, clears `payout_id` on its entries for the next run and alerts
 * staff. Every other error is thrown, so the outbox retries with backoff.
 */
import { formatDateTimeET, formatMoney, type Payout, type WithId } from '@instasupply/shared';
import { withTransaction } from '../../platform/db/tx';
import { ApiError } from '../../platform/http/errors';
import { registerHandler } from '../../platform/outbox/registry';
import { notify, notifyStaff, notifyStoreMembers, type NotificationInput } from '../notifications/notify';
import { findPayout, lockPayout, markPayoutFailed, markPayoutPaid, payeeInfo } from './repository';

export function isDefiniteRefusal(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 'failed-precondition';
  return typeof error === 'object' && error !== null && 'refused' in error && error.refused === true;
}

/** "Thu, Nov 19" for the payout's Toronto day. */
const dayOf = (payout: Pick<Payout, 'createdAt'>): string =>
  formatDateTimeET(payout.createdAt).split(', ').slice(0, 2).join(', ');

export function payoutSentNotification(payout: WithId<Payout>): NotificationInput {
  return {
    type: 'payout_sent',
    title: `Payout ${formatMoney(payout.netCents)} for ${dayOf(payout)}`,
    body: `${formatMoney(payout.netCents)} is on its way to your account (${payout.entryCount} item${payout.entryCount === 1 ? '' : 's'}).`,
    data: { payoutId: payout.id },
    key: `payout-${payout.id}`,
  };
}

export function registerTransferHandler(): void {
  registerHandler<{ payoutId: string }>('payout.transfer', async ({ payoutId }, { deps }) => {
    const payout = await findPayout(deps.pool, payoutId);
    if (!payout || payout.status !== 'pending') return;
    const info = await payeeInfo(deps.pool, payout.payeeType, payout.payeeId);
    const accountRef =
      info.accountRef ??
      (deps.config.PAYMENTS_MODE === 'stripe' ? null : `test_${payout.payeeType}_${payout.payeeId}`);

    let reference: string | null = null;
    let refused: unknown = null;
    if (accountRef === null) {
      refused = new Error('The payee has no payout account.');
    } else {
      try {
        const answer = await deps.gateway.transfer({
          idempotencyKey: `payout_${payout.id}`,
          payeeType: payout.payeeType,
          accountRef,
          amountCents: payout.netCents,
        });
        reference = answer.ref;
      } catch (error) {
        if (!isDefiniteRefusal(error)) throw error;
        refused = error;
      }
    }

    await withTransaction(deps, async (tx) => {
      const locked = await lockPayout(tx, payoutId);
      if (!locked || locked.status !== 'pending') return;
      if (reference !== null) {
        await markPayoutPaid(tx, locked, reference);
        const message = payoutSentNotification(locked);
        if (locked.payeeType === 'store') {
          await notifyStoreMembers(tx, locked.payeeId, message, { ownersOnly: true });
        } else {
          await notify(tx, locked.payeeId, message);
        }
        return;
      }
      await markPayoutFailed(tx, locked);
      await notifyStaff(tx, {
        type: 'system',
        title: 'Payout failed',
        body: `The payout of ${formatMoney(locked.netCents)} to ${locked.payeeName} was refused: ${
          refused instanceof Error ? refused.message.slice(0, 200) : 'refused'
        }. Its entries go into the next run.`,
        data: { payoutId: locked.id },
        key: `payout-failed-${locked.id}`,
      });
    });
  });
}
