/**
 * The public tracking document of a delivery (docs/PLATFORM.md §9.4; port of
 * legacy/…/tracking/tracking-service.ts). It never contains the driver's other stops, phone number or full name.
 *
 * `syncTracking` runs inside every delivery transaction (through `applyDeliveryEffects`) and writes only the
 * fields that delivery transactions own. The live position belongs to `reportLocation`, `stopsBefore` to the
 * route planner and the provider ETA to the `tracking.eta` handler.
 */
import {
  ACTIVE_STATUSES,
  LIVE_TRACKING_STATUSES,
  PROGRESS_STEPS,
  STATUS_TIMESTAMP_FIELD,
  VEHICLE_CLASSES,
  estimateDriveSeconds,
  estimateRoadMeters,
  firstName,
  haversineMeters,
  trackingPhaseFor,
  windowLabel,
  type Delivery,
  type DeliveryStatus,
  type DriverVehicle,
  type LatLng,
  type VehicleClass,
} from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import {
  LOCATION_COLUMNS,
  patchTracking,
  publishTracking,
  type DriverLocationRow,
  type TrackingDoc,
  type TrackingRow,
} from './tracking.repository';

type DriverBlock = NonNullable<TrackingDoc['driver']>;

/** The class-speed estimate of the drive from `from` to `to` (§9.6 "Live ETA"). */
export function estimateEta(
  from: LatLng,
  to: LatLng,
  capacityClass: VehicleClass | null,
): { etaSeconds: number; distanceMeters: number } {
  const meters = estimateRoadMeters(haversineMeters(from, to));
  const speed = capacityClass ? VEHICLE_CLASSES[capacityClass]?.speedKmh : undefined;
  return { etaSeconds: Math.round(estimateDriveSeconds(meters, speed)), distanceMeters: Math.round(meters) };
}

export const isLiveStatus = (status: DeliveryStatus): boolean => LIVE_TRACKING_STATUSES.includes(status);

/** "Ford F-150 · CBKX 214"; null without an approved vehicle. */
export function vehicleLabel(vehicle: DriverVehicle | null | undefined): string | null {
  if (!vehicle) return null;
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ').trim();
  const parts = [name, vehicle.plate].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function timelineOf(delivery: Delivery): TrackingDoc['timeline'] {
  const steps: readonly DeliveryStatus[] = [...PROGRESS_STEPS, 'accepted', 'failed', 'cancelled'];
  const seen = new Set<DeliveryStatus>(['unassigned']);
  const timeline: TrackingDoc['timeline'] = [{ status: 'unassigned', at: delivery.createdAt }];
  const fields = delivery as unknown as Record<string, unknown>;
  for (const status of steps) {
    if (seen.has(status)) continue;
    seen.add(status);
    const field = STATUS_TIMESTAMP_FIELD[status];
    const at = field ? fields[field] : null;
    if (typeof at === 'number') timeline.push({ status, at });
  }
  return timeline.sort((a, b) => a.at - b.at);
}

function unloadNote(delivery: Delivery): string | null {
  const unload = delivery.unload;
  if (!unload || unload.status === 'not_needed') return null;
  if (unload.status === 'booked') return 'A labourer is booked to help unload.';
  return 'A labourer will help unload.';
}

function windowText(delivery: Delivery, now: number): string | null {
  if (delivery.windowStart != null && delivery.windowEnd != null) {
    return windowLabel({ kind: 'scheduled', startAt: delivery.windowStart, endAt: delivery.windowEnd }, now);
  }
  if (delivery.windowEnd != null) {
    return windowLabel({ kind: 'asap', startAt: delivery.windowEnd, endAt: delivery.windowEnd }, now);
  }
  return null;
}

interface DriverProfileRow {
  display_name: string;
  vehicle: DriverVehicle | null;
  capacity_class: VehicleClass | null;
}

/** The fields delivery transactions own (§9.4), without the driver block and the live fields. */
function deliveryFields(
  delivery: Delivery,
  handoffCode: string | null,
  now: number,
): Omit<TrackingDoc, 'driver' | 'etaSeconds' | 'distanceMeters' | 'stopsBefore'> {
  const marketplace = delivery.kind === 'marketplace';
  return {
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    kind: delivery.kind,
    status: delivery.status,
    phase: trackingPhaseFor(delivery),
    storeOrderNumber: marketplace ? delivery.orderId : null,
    customerFirstName: firstName(delivery.customer.name),
    address: delivery.address,
    destination: { lat: delivery.location.lat, lng: delivery.location.lng },
    pickup: delivery.pickup
      ? { storeName: delivery.pickup.storeName, location: delivery.pickup.location }
      : null,
    deliverBy: delivery.windowEnd ?? null,
    windowLabel: windowText(delivery, now),
    receiving: delivery.receiving ?? null,
    unloadNote: unloadNote(delivery),
    handoffCode: delivery.requireCode ? handoffCode : null,
    timeline: timelineOf(delivery),
  };
}

/**
 * Writes the delivery-owned fields of `tracking` for one delivery (§9.4): status, phase, timeline, pickup,
 * deliver-by, hand-off code, the driver's first name and vehicle, and `driver = null` when the driver leaves.
 * Creates the row on the first call (the delivery row and its private meta must already be written in this
 * transaction). The row is locked and read in this transaction; only changed fields are written.
 *
 * At the edges of the live phase it also hands the live fields over: entering `in_transit`/`arrived` it seeds
 * the position and the class-speed ETA from the driver's current location; leaving it (delivered, failed,
 * reassigned) it clears them, so a finished trip never shows a moving driver or an ETA again.
 */
export async function syncTracking(tx: Tx, delivery: Delivery): Promise<void> {
  const { rows: metaRows } = await tx.query<{ token: string | null; handoff_code: string | null }>(
    `SELECT meta->>'trackingToken' AS token, meta->>'handoffCode' AS handoff_code FROM deliveries WHERE id = $1`,
    [delivery.id],
  );
  const meta = metaRows[0];
  if (!meta?.token) return;

  const { rows: trackingRows } = await tx.query<TrackingRow>(
    `SELECT token, delivery_id, doc, eta_computed_at, updated_at FROM tracking WHERE token = $1 FOR NO KEY UPDATE`,
    [meta.token],
  );
  const existing = trackingRows[0] ?? null;

  let profile: DriverProfileRow | null = null;
  let location: DriverLocationRow | null = null;
  if (delivery.driverId) {
    const [profiles, locations] = await Promise.all([
      tx.query<DriverProfileRow>(
        `SELECT display_name, doc->'vehicle' AS vehicle, capacity_class FROM users WHERE id = $1`,
        [delivery.driverId],
      ),
      tx.query<DriverLocationRow>(`SELECT ${LOCATION_COLUMNS} FROM driver_locations WHERE driver_id = $1`, [
        delivery.driverId,
      ]),
    ]);
    profile = profiles.rows[0] ?? null;
    location = locations.rows[0] ?? null;
  }

  const fields = deliveryFields(delivery, meta.handoff_code, tx.now);
  const live = isLiveStatus(delivery.status);
  const wasLive = existing ? isLiveStatus(existing.doc.status) : false;
  const before = existing?.doc.driver ?? null;

  let driver: DriverBlock | null = null;
  let newDriver = false;
  if (delivery.driverId) {
    const name = firstName(profile?.display_name || delivery.driverName || '');
    const vehicle = vehicleLabel(profile?.vehicle);
    newDriver = !before || before.firstName !== name || before.vehicle !== vehicle;
    const seed = live && (newDriver || !wasLive) ? location : null;
    const keep = live && !seed && !newDriver ? before : null;
    driver = {
      firstName: name,
      vehicle,
      location: seed ? { lat: seed.lat, lng: seed.lng } : (keep?.location ?? null),
      heading: seed ? seed.heading : (keep?.heading ?? null),
      updatedAt: seed ? seed.updated_at : (keep?.updatedAt ?? null),
    };
  }

  // The live fields change hands only at the edges of the live phase (see above).
  const liveFields: Partial<Pick<TrackingDoc, 'etaSeconds' | 'distanceMeters'>> = {};
  if (!live) {
    liveFields.etaSeconds = null;
    liveFields.distanceMeters = null;
  } else if ((!wasLive || newDriver) && driver?.location) {
    const estimate = estimateEta(driver.location, delivery.location, profile?.capacity_class ?? null);
    liveFields.etaSeconds = delivery.status === 'arrived' ? 0 : estimate.etaSeconds;
    liveFields.distanceMeters = estimate.distanceMeters;
  } else if (delivery.status === 'arrived') {
    liveFields.etaSeconds = 0;
  }
  const leftRoute = !ACTIVE_STATUSES.includes(delivery.status) || !delivery.driverId || newDriver;

  if (!existing) {
    const doc: TrackingDoc = {
      ...fields,
      driver,
      etaSeconds: liveFields.etaSeconds ?? null,
      distanceMeters: liveFields.distanceMeters ?? null,
      stopsBefore: null,
    };
    const { rows } = await tx.query<TrackingRow>(
      `INSERT INTO tracking (token, delivery_id, doc, eta_computed_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NULL, $4)
       RETURNING token, delivery_id, doc, eta_computed_at, updated_at`,
      [meta.token, delivery.id, JSON.stringify(doc), new Date(tx.now)],
    );
    await publishTracking(tx, rows[0]!);
    return;
  }

  await patchTracking(tx, existing, {
    ...fields,
    driver,
    ...liveFields,
    ...(leftRoute ? { stopsBefore: null } : {}),
  });
}
