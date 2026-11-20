/**
 * The job offer of a marketplace delivery (MARKETPLACE §2.4, D9; docs/PLATFORM.md §9.1): a PII-free copy of
 * the delivery that exists exactly while the delivery is `unassigned` and offered. Owned by `deliveries`.
 */
import {
  VEHICLE_CLASSES,
  audienceFor,
  windowLabel,
  type Delivery,
  type JobOffer,
  type VehicleClass,
} from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';
import { notifyOfferOpened } from './offer-effects';
import { lockOffer, offerInputs, removeOffer, upsertOffer } from './repository';

const round2 = (value: number): number => Math.round(value * 100) / 100;
const isVehicleClass = (value: string | null | undefined): value is VehicleClass =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(VEHICLE_CLASSES, value);

/**
 * Builds the offer from the delivery with a fixed field list (§7.4): the drop-off is the jobsite's area
 * label and a pin rounded to 2 decimals; no name, phone, address line or site contact is copied.
 */
export async function buildOffer(
  tx: Tx,
  delivery: Delivery,
  state: Pick<JobOffer, 'status' | 'opensAt' | 'openedAt' | 'nudgedAt' | 'createdAt'>,
): Promise<JobOffer> {
  const pickup = delivery.pickup!;
  const jobClass = delivery.vehicleClass!;
  const inputs = await offerInputs(tx, delivery.storeOrderId!, pickup.storeId);
  const siteMaxValue = inputs.jobsite?.maxVehicleClass;
  const siteMax = isVehicleClass(siteMaxValue) ? siteMaxValue : null;
  const window = inputs.window ?? {
    kind: delivery.windowStart === null ? ('asap' as const) : ('scheduled' as const),
    startAt: delivery.windowStart,
    endAt: delivery.windowEnd ?? pickup.readyBy,
  };
  const payout = delivery.payout ?? {
    offerCents: 0,
    baseCents: 0,
    distanceCents: 0,
    loadCents: 0,
    handlingCents: 0,
    boostCents: 0,
    waitCents: 0,
    totalCents: 0,
  };
  const load = delivery.load;
  return {
    deliveryId: delivery.id,
    storeOrderNumber: delivery.orderId,
    status: state.status,
    audience: audienceFor(delivery.cityIds, jobClass, siteMax),
    cityIds: [...delivery.cityIds],
    vehicleClass: jobClass,
    vehicleClassRank: VEHICLE_CLASSES[jobClass].rank,
    opensAt: state.opensAt,
    openedAt: state.openedAt,
    pickup: {
      storeName: pickup.storeName,
      areaLabel: inputs.storeAreaLabel ?? '',
      location: pickup.location,
      readyBy: pickup.readyBy,
      ready: pickup.ready,
    },
    dropoff: {
      areaLabel: inputs.jobsite?.areaLabel ?? '',
      approxLocation: { lat: round2(delivery.location.lat), lng: round2(delivery.location.lng) },
    },
    tripKm: delivery.tripKm ?? 0,
    window: {
      kind: window.kind,
      startAt: window.startAt,
      endAt: window.endAt,
      label: windowLabel(window, tx.now),
    },
    load: {
      summary: load?.summary ?? '',
      pieces: load?.pieces ?? 0,
      weightKg: load?.weightKg ?? 0,
      longestCm: load?.longestCm ?? 0,
      hasSheets: load?.hasSheets ?? false,
      heavy: load?.heavy ?? false,
      lines: (load?.lines ?? []).slice(0, 5).map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
      })),
    },
    unload: delivery.unload?.labourer
      ? 'labourer'
      : delivery.receiving === 'attended'
        ? 'site_crew'
        : 'driver',
    payoutCents: payout.offerCents + payout.boostCents,
    payoutBreakdown: {
      baseCents: payout.baseCents,
      distanceCents: payout.distanceCents,
      loadCents: payout.loadCents,
      handlingCents: payout.handlingCents,
      boostCents: payout.boostCents,
    },
    nudgedAt: state.nudgedAt,
    createdAt: state.createdAt,
    updatedAt: tx.now,
  };
}

/**
 * Creates or refreshes the offer of an `unassigned` marketplace delivery: `open` (with `openedAt = now`)
 * when `opensAt ≤ now`, else `scheduled`. An offer that is already open keeps its `openedAt` and nudge, so
 * calling it again after a change of the delivery (ready, boost) only refreshes the copy. It mirrors
 * `offerStatus` and `offerOpensAt` on the delivery document when they differ, and tells fitting online
 * drivers when the offer has just opened (§9.4). Does nothing for any other delivery: one that dispatch
 * already assigned keeps its driver. The caller holds the delivery's lock (lockGraph with `withOffers`).
 */
export async function stageJobOffer(tx: Tx, delivery: Delivery, opts: { opensAt: number }): Promise<void> {
  if (
    delivery.kind !== 'marketplace' ||
    delivery.status !== 'unassigned' ||
    !delivery.pickup ||
    !delivery.vehicleClass ||
    !delivery.storeOrderId
  ) {
    return;
  }
  const existing = await lockOffer(tx, delivery.id);
  const open = opts.opensAt <= tx.now;
  const status: JobOffer['status'] = open ? 'open' : 'scheduled';
  const wasOpen = existing?.status === 'open';
  const offer = await buildOffer(tx, delivery, {
    status,
    opensAt: opts.opensAt,
    openedAt: open ? (wasOpen && existing.openedAt !== null ? existing.openedAt : tx.now) : null,
    nudgedAt: open && wasOpen ? existing.nudgedAt : null,
    createdAt: existing?.createdAt ?? tx.now,
  });
  await upsertOffer(tx, offer, existing?.status ?? null);

  const offerOpensAt = delivery.offerOpensAt ?? opts.opensAt;
  if (delivery.offerStatus !== status || delivery.offerOpensAt !== offerOpensAt) {
    await tx.query('UPDATE deliveries SET doc = doc || $2::jsonb, updated_at = $3 WHERE id = $1', [
      delivery.id,
      JSON.stringify({ offerStatus: status, offerOpensAt }),
      new Date(tx.now),
    ]);
    await publishChange(tx, 'deliveries', 'updated', { id: delivery.id, driverId: delivery.driverId });
  }
  if (open && !wasOpen) await notifyOfferOpened(tx, offer);
}

/** Removes the offer of a delivery (claimed, assigned or cancelled). Does nothing when there is none. */
export async function deleteJobOffer(tx: Tx, deliveryId: string): Promise<void> {
  await removeOffer(tx, deliveryId);
}
