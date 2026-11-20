/**
 * `boostJobPayout` (P1, staff; MARKETPLACE §3.10, docs/PLATFORM.md §9.2.13): +$5/$10/$15/$20 on a job that
 * nobody has claimed. The delivery's payout and the offer card change in one transaction; fitting online
 * drivers are told again when the offer is open. Additive, so not retry-safe (the console confirms).
 */
import {
  formatMoney,
  withBoost,
  type BoostJobPayoutRequest,
  type JobOffer,
  type OkResponse,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failedPrecondition, notFound } from '../../platform/http/errors';
import { applyDeliveryEffects } from '../deliveries/delivery-effects';
import { eventActorOf } from '../deliveries/delivery-writer';
import { deliveryOf, insertEvent, saveDelivery } from '../deliveries/repository';
import { notifyDrivers } from '../notifications';
import { offerSummary } from './offer-effects';
import { stageJobOffer } from './offers';
import { findOffer, onlineDriversFor } from './repository';

export async function boostJobPayout(
  ctx: RequestContext,
  actor: Actor,
  req: BoostJobPayoutRequest,
): Promise<OkResponse> {
  await withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, { deliveryIds: [req.deliveryId], withOffers: true });
    const delivery = deliveryOf(graph, req.deliveryId);
    if (!delivery) notFound('This job no longer exists.');
    const offerRow = graph.offers.get(req.deliveryId);
    const offer = offerRow ? (offerRow.doc as unknown as Omit<JobOffer, 'deliveryId'>) : null;
    if (!offer || delivery.status !== 'unassigned' || !delivery.payout) {
      failedPrecondition('Only a job that is on the board and not claimed can be boosted.');
    }
    const saved = await saveDelivery(tx, graph, {
      ...delivery,
      payout: withBoost(delivery.payout, req.addCents),
      updatedBy: actor.uid,
    });
    await insertEvent(tx, saved, eventActorOf(actor), {
      type: 'note',
      message: `Payout boosted by ${formatMoney(req.addCents)}`,
    });
    await stageJobOffer(tx, saved, { opensAt: offer.opensAt });
    await applyDeliveryEffects(tx, graph, delivery, saved);

    const refreshed = await findOffer(tx, req.deliveryId);
    if (refreshed && refreshed.status === 'open') {
      const drivers = await onlineDriversFor(tx, refreshed.audience);
      await notifyDrivers(tx, drivers, {
        type: 'job_offer',
        title: `Boosted job · ${formatMoney(refreshed.payoutCents)}`,
        body: offerSummary(refreshed),
        data: { deliveryId: refreshed.deliveryId },
        key: `offer-boost-${refreshed.deliveryId}-${saved.payout?.boostCents ?? 0}`,
      });
    }
  });
  return { ok: true };
}
