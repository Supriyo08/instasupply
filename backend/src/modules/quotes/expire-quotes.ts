/**
 * expireQuotes (MARKETPLACE §5.7; docs/PLATFORM.md §9.5), every 15 minutes: quoted offers whose
 * `offerValidUntil` has passed become `expired`. Candidates come from index 25 in pages of 200; each quote is
 * handled in its own transaction and checked again under its lock.
 */
import type { Deps } from '../../container';
import { withTransaction } from '../../platform/db/tx';
import type { JobResult } from '../../platform/scheduler/registry';
import { expiredQuoteCandidates, lockQuote, saveQuote } from './repository';

export async function runExpireQuotes(deps: Deps, now: number): Promise<JobResult> {
  let expired = 0;
  let errors = 0;
  const failed: string[] = [];
  for (;;) {
    const ids = await expiredQuoteCandidates(deps.pool, now, failed);
    if (ids.length === 0) break;
    for (const id of ids) {
      try {
        const changed = await withTransaction(
          deps,
          async (tx) => {
            const quote = await lockQuote(tx, id);
            if (!quote || quote.status !== 'quoted' || quote.offerValidUntil === null) return false;
            if (quote.offerValidUntil > tx.now) return false;
            await saveQuote(tx, {
              ...quote,
              status: 'expired',
              statusAt: { ...quote.statusAt, expired: tx.now },
            });
            return true;
          },
          { now },
        );
        if (changed) expired += 1;
        else failed.push(id);
      } catch (error) {
        errors += 1;
        failed.push(id);
        deps.log.error({ err: error, quoteId: id }, 'expireQuotes: a quote could not be expired');
      }
    }
  }
  return { expired, errors };
}
