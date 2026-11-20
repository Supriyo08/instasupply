/**
 * `publishDueJobOffers`, every 5 minutes (MARKETPLACE §5.7; docs/PLATFORM.md §9.5). (1) Scheduled offers
 * whose `opensAt` has come open, each in its own transaction under `lockGraph`; an offer whose delivery is
 * no longer `unassigned` is deleted instead. (2) Offers open for 15 minutes without a claim nudge staff once.
 */
import { JOB_UNCLAIMED_ALERT_MIN, type JobOffer } from '@instasupply/shared';
import type { Deps } from '../../container';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { deliveryOf } from '../deliveries/repository';
import { notifyStaff } from '../notifications';
import { deleteJobOffer, stageJobOffer } from './offers';
import { dueScheduledOfferIds, toOffer, unclaimedOfferIds, upsertOffer, type OfferRow } from './repository';

const BATCH = 200;

/** Selects candidates until none is left; a row that throws is logged, counted and skipped (§9.5). */
async function eachCandidate(
  deps: Deps,
  select: (skip: Set<string>) => Promise<string[]>,
  handle: (id: string) => Promise<void>,
  counts: { errors: number },
  job: string,
): Promise<void> {
  const seen = new Set<string>();
  for (;;) {
    const ids = (await select(seen)).filter((id) => !seen.has(id));
    if (ids.length === 0) return;
    for (const id of ids) {
      seen.add(id);
      try {
        await handle(id);
      } catch (error) {
        counts.errors += 1;
        deps.log.error({ err: error, job, deliveryId: id }, 'scheduled job row failed');
      }
    }
  }
}

export async function runPublishDueJobOffers(deps: Deps, now: number): Promise<Record<string, number>> {
  const result = { opened: 0, removed: 0, nudged: 0, errors: 0 };

  await eachCandidate(
    deps,
    async (seen) => dueScheduledOfferIds(deps.pool, now, BATCH + seen.size),
    async (id) => {
      await withTransaction(
        deps,
        async (tx) => {
          const graph = await lockGraph(tx, { deliveryIds: [id], withOffers: true });
          const row = graph.offers.get(id);
          if (!row) return;
          const offer = toOffer(row as unknown as OfferRow);
          if (offer.status !== 'scheduled' || offer.opensAt > now) return;
          const delivery = deliveryOf(graph, id);
          if (!delivery || delivery.status !== 'unassigned') {
            await deleteJobOffer(tx, id);
            result.removed += 1;
            return;
          }
          await stageJobOffer(tx, delivery, { opensAt: offer.opensAt });
          const after = {
            ...delivery,
            offerStatus: 'open' as const,
            offerOpensAt: delivery.offerOpensAt ?? offer.opensAt,
            updatedAt: now,
          };
          await applyDeliveryEffects(tx, graph, delivery, after);
          result.opened += 1;
        },
        { now },
      );
    },
    result,
    'publishDueJobOffers',
  );

  const unclaimedBefore = now - JOB_UNCLAIMED_ALERT_MIN * 60_000;
  await eachCandidate(
    deps,
    async (seen) => unclaimedOfferIds(deps.pool, unclaimedBefore, BATCH + seen.size),
    async (id) => {
      await withTransaction(
        deps,
        async (tx) => {
          const graph = await lockGraph(tx, { deliveryIds: [id], withOffers: true });
          const row = graph.offers.get(id);
          if (!row) return;
          const offer = toOffer(row as unknown as OfferRow);
          if (offer.status !== 'open' || offer.nudgedAt !== null || offer.openedAt === null) return;
          if (offer.openedAt > unclaimedBefore) return;
          const { id: _id, ...plain } = offer;
          const next: JobOffer = { ...plain, nudgedAt: now };
          await upsertOffer(tx, next, offer.status);
          await notifyStaff(tx, {
            type: 'job_unclaimed',
            title: `${offer.storeOrderNumber} has no driver yet`,
            body: `Open for ${JOB_UNCLAIMED_ALERT_MIN} min without a claim (${offer.pickup.storeName}). Assign a driver or boost the pay.`,
            data: { deliveryId: id },
            key: `offer-unclaimed-${id}-${offer.openedAt}`,
          });
          result.nudged += 1;
        },
        { now },
      );
    },
    result,
    'publishDueJobOffers',
  );
  return result;
}
