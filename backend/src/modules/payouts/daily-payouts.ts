/**
 * `runDailyPayouts(deps, now)` (docs/PLATFORM.md §9.5, MARKETPLACE §3.9), daily at 21:00 America/Toronto and
 * through `runJobNow`:
 *
 * 1. Resume: every `pending` payout gets its `payout.transfer` again (dedupe key and gateway key make it safe).
 * 2. Payees: everyone with unpaid, not held entries created up to `now`.
 * 3. Per payee, one transaction: lock those entries in id order and sum them. Net ≤ 0 carries over. In
 *    `stripe` mode a payee without a payout account carries over (`skippedNoAccount`, one staff alert per
 *    run). Net > 0: insert `{payeeType}_{payeeId}_{runKey}` as `pending` (ON CONFLICT DO NOTHING), stamp its
 *    entries, enqueue `payout.transfer` — all in the one transaction, so "payout created, entries not
 *    stamped" cannot happen, and a second run with the same `now` (or a concurrent one) finds nothing.
 */
import { localDateOf, toLocal } from '@instasupply/shared';
import type { Deps } from '../../container';
import { withTransaction } from '../../platform/db/tx';
import { enqueue } from '../../platform/outbox/outbox';
import { notifyStaff } from '../notifications/notify';
import {
  insertPayout,
  lockUnpaidEntries,
  payeeInfo,
  pendingPayoutIds,
  stampEntries,
  unpaidPayees,
} from './repository';

export interface DailyPayoutsResult extends Record<string, number> {
  payees: number;
  payouts: number;
  carriedOver: number;
  skippedNoAccount: number;
  resumed: number;
  errors: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYYMMDD-HHMM` of `now` in Toronto. */
export function runKeyOf(now: number): string {
  const local = toLocal(now);
  return `${local.date.replaceAll('-', '')}-${pad2(Math.floor(local.minutes / 60))}${pad2(local.minutes % 60)}`;
}

export const payoutIdOf = (payeeType: 'store' | 'driver', payeeId: string, runKey: string): string =>
  `${payeeType}_${payeeId}_${runKey}`;

export const transferDedupeKey = (payoutId: string): string => `payout.transfer:${payoutId}`;

type Outcome = 'paid' | 'carried' | 'no_account' | 'none';

export async function runDailyPayouts(deps: Deps, now: number): Promise<DailyPayoutsResult> {
  const result: DailyPayoutsResult = {
    payees: 0,
    payouts: 0,
    carriedOver: 0,
    skippedNoAccount: 0,
    resumed: 0,
    errors: 0,
  };
  const runKey = runKeyOf(now);
  const stripe = deps.config.PAYMENTS_MODE === 'stripe';

  // 1. Resume the payouts a crash or a lost answer left pending.
  for (const payoutId of await pendingPayoutIds(deps.pool)) {
    await withTransaction(
      deps,
      (tx) => enqueue(tx, 'payout.transfer', { payoutId }, { dedupeKey: transferDedupeKey(payoutId) }),
      { now },
    );
    result.resumed += 1;
  }

  // 2 and 3. One transaction per payee.
  for (const payee of await unpaidPayees(deps.pool, now)) {
    result.payees += 1;
    try {
      const outcome = await withTransaction<Outcome>(
        deps,
        async (tx) => {
          const entries = await lockUnpaidEntries(tx, payee.payee_type, payee.payee_id, now);
          if (entries.length === 0) return 'none';
          let credits = 0;
          let debits = 0;
          for (const e of entries) {
            if (e.amount_cents >= 0) credits += e.amount_cents;
            else debits -= e.amount_cents;
          }
          const net = credits - debits;
          if (net <= 0) return 'carried';
          const info = await payeeInfo(tx, payee.payee_type, payee.payee_id);
          if (stripe && !info.accountRef) return 'no_account';
          const id = payoutIdOf(payee.payee_type, payee.payee_id, runKey);
          const inserted = await insertPayout(tx, {
            id,
            payeeType: payee.payee_type,
            payeeId: payee.payee_id,
            payeeName: info.name,
            runKey,
            periodDate: localDateOf(now),
            entryIds: entries.map((e) => e.id),
            entryCount: entries.length,
            creditsCents: credits,
            debitsCents: debits,
            netCents: net,
            status: 'pending',
            provider: stripe ? 'stripe' : 'test',
            reference: null,
            createdAt: now,
            paidAt: null,
          });
          await deps.hooks.at('payouts:afterPayoutInsert');
          // A payout of this run already exists for the payee (it failed and released its entries):
          // the entries wait for the next run.
          if (!inserted) return 'carried';
          await stampEntries(
            tx,
            id,
            entries.map((e) => e.id),
          );
          await enqueue(tx, 'payout.transfer', { payoutId: id }, { dedupeKey: transferDedupeKey(id) });
          return 'paid';
        },
        { now },
      );
      if (outcome === 'paid') result.payouts += 1;
      else if (outcome === 'carried') result.carriedOver += 1;
      else if (outcome === 'no_account') result.skippedNoAccount += 1;
    } catch (error) {
      result.errors += 1;
      deps.log.error(
        { job: 'runDailyPayouts', payeeType: payee.payee_type, err: error },
        'payout of one payee failed',
      );
    }
  }

  if (result.skippedNoAccount > 0) {
    await withTransaction(
      deps,
      (tx) =>
        notifyStaff(tx, {
          type: 'system',
          title: 'Payouts skipped',
          body: `${result.skippedNoAccount} payee${result.skippedNoAccount === 1 ? '' : 's'} could not be paid: no payout account is set up.`,
          key: `payout-skipped-${runKey}`,
        }),
      { now },
    );
  }
  return result;
}
