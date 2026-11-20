/**
 * The payouts module (docs/PLATFORM.md §2.1, §15.2 `money-comms`): the ledger writers of §9.1, the daily
 * payout run (§9.5), the `payout.transfer` outbox handler (§9.3) and the ledger and payout endpoints
 * (§5.3.8). Other modules call the ledger writers through this barrel.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerJob } from '../../platform/scheduler/registry';
import { runDailyPayouts } from './daily-payouts';
import { registerPayoutRoutes } from './routes';
import { registerTransferHandler } from './transfer.handler';

export { canReadPayee, resolvePayeeScope } from './access';
export { payoutIdOf, runDailyPayouts, runKeyOf, type DailyPayoutsResult } from './daily-payouts';
export { recordClawback, recordDeliveryLedger, recordStoreOrderLedger } from './ledger';
export { isDefiniteRefusal } from './transfer.handler';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerPayoutRoutes(app);
  registerTransferHandler();
  registerJob({
    name: 'runDailyPayouts',
    schedule: { dailyAt: { hour: 21, minute: 0 } },
    run: runDailyPayouts,
  });
}
