/**
 * POST /me/location (docs/PLATFORM.md §5.3.3, §9.4 `onDriverLocationWritten`; port of
 * legacy/…/tracking/triggers.ts). One short transaction: the driver's location row, the live event, and when
 * the driver moved enough (or went on- or offline) the tracking documents of the trips they are driving.
 */
import {
  haversineMeters,
  type Fix,
  type LocationAck,
  type LocationReport,
  type VehicleClass,
} from '@instasupply/shared';
import { z } from 'zod';
import type { Deps } from '../../container';
import { RetryTransaction, withTransaction, type Tx } from '../../platform/db/tx';
import { failCode } from '../../platform/http/errors';
import { enqueue } from '../../platform/outbox/outbox';
import { routingMode } from '../geocoding';
import { estimateEta } from './tracking-service';
import {
  LOCATION_COLUMNS,
  lockTrackingByDelivery,
  patchTracking,
  publishDriverLocation,
  type DriverLocationRow,
} from './tracking.repository';

/** At most one report per 2 s, except one that changes `online` (§5.3.3). */
export const REPORT_INTERVAL_MS = 2000;
/** GPS jitter: tracking pages are refreshed after 15 m of movement or 20 s (the legacy thresholds). */
export const SYNC_MIN_MOVE_METERS = 15;
export const SYNC_MIN_INTERVAL_MS = 20_000;
/** A provider ETA at most once per 60 s per delivery (§9.6). */
export const PROVIDER_ETA_INTERVAL_MS = 60_000;

const fixSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().min(-360).max(720).nullable(),
    speed: z.number().min(0).max(200).nullable(),
    accuracy: z.number().min(0).max(100_000).nullable(),
    at: z.number().int().min(0).max(8_640_000_000_000),
  })
  .strict();

export const LocationReportSchema = z
  .object({
    online: z.boolean(),
    mode: z.enum(['normal', 'live']),
    battery: z.number().min(0).max(1).nullable(),
    fixes: z.array(fixSchema).max(20),
  })
  .strict()
  .refine((report) => report.fixes.length > 0 || !report.online, {
    message: 'Send at least one fix while online.',
    path: ['fixes'],
  });

const normalizeHeading = (heading: number | null): number | null =>
  heading === null ? null : ((heading % 360) + 360) % 360;

/** The newest fix that is not older than the stored position (older fixes are ignored, §9.4). */
function newestFix(fixes: readonly Fix[], storedAt: number | null): Fix | null {
  let best: Fix | null = null;
  for (const fix of fixes) {
    if (storedAt !== null && fix.at < storedAt) continue;
    if (!best || fix.at >= best.at) best = fix;
  }
  return best;
}

interface Outcome {
  row: DriverLocationRow | null;
}

/** Was onDriverLocationWritten. `now` is the server clock of the request; `updatedAt` is always server time. */
export async function reportLocation(
  deps: Deps,
  uid: string,
  report: LocationReport,
  now: number,
): Promise<LocationAck> {
  const providerEta = routingMode(deps.config) !== 'estimate';
  const outcome = await withTransaction(deps, (tx) => writeReport(tx, uid, report, providerEta), { now });
  return { online: outcome.row?.online ?? false, serverTime: now };
}

async function writeReport(
  tx: Tx,
  uid: string,
  report: LocationReport,
  providerEta: boolean,
): Promise<Outcome> {
  const { rows } = await tx.query<DriverLocationRow>(
    `SELECT ${LOCATION_COLUMNS} FROM driver_locations WHERE driver_id = $1 FOR NO KEY UPDATE`,
    [uid],
  );
  const stored = rows[0] ?? null;
  const onlineChanged = stored === null || stored.online !== report.online;
  if (stored && !onlineChanged && tx.now - stored.updated_at < REPORT_INTERVAL_MS) {
    const retryAfterMs = REPORT_INTERVAL_MS - (tx.now - stored.updated_at);
    failCode('RATE_LIMITED', 'Location reports are limited to one every 2 seconds.', { retryAfterMs });
  }

  const fix = newestFix(report.fixes, stored?.updated_at ?? null);
  let row: DriverLocationRow;
  if (!stored) {
    // Nothing to store without a position: an offline report before the first fix changes nothing.
    if (!fix) return { row: null };
    const inserted = await tx.query<DriverLocationRow>(
      `INSERT INTO driver_locations (driver_id, lat, lng, heading, speed, accuracy, battery, online, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (driver_id) DO NOTHING
       RETURNING ${LOCATION_COLUMNS}`,
      [
        uid,
        fix.lat,
        fix.lng,
        normalizeHeading(fix.heading),
        fix.speed,
        fix.accuracy,
        report.battery,
        report.online,
        new Date(tx.now),
      ],
    );
    // A concurrent first report won: run again against its row (it now decides the 2-second rule).
    if (!inserted.rows[0]) throw new RetryTransaction();
    row = inserted.rows[0];
  } else {
    const updated = await tx.query<DriverLocationRow>(
      `UPDATE driver_locations SET
         lat = COALESCE($2, lat), lng = COALESCE($3, lng),
         heading = CASE WHEN $9 THEN $4 ELSE heading END,
         speed = CASE WHEN $9 THEN $5 ELSE speed END,
         accuracy = CASE WHEN $9 THEN $6 ELSE accuracy END,
         battery = COALESCE($7, battery), online = $8, updated_at = $10
       WHERE driver_id = $1
       RETURNING ${LOCATION_COLUMNS}`,
      [
        uid,
        fix?.lat ?? null,
        fix?.lng ?? null,
        fix ? normalizeHeading(fix.heading) : null,
        fix?.speed ?? null,
        fix?.accuracy ?? null,
        report.battery,
        report.online,
        fix !== null,
        new Date(tx.now),
      ],
    );
    row = updated.rows[0]!;
  }
  await publishDriverLocation(tx, row);

  const moved =
    row.synced_lat === null || row.synced_lng === null
      ? Number.POSITIVE_INFINITY
      : haversineMeters({ lat: row.synced_lat, lng: row.synced_lng }, { lat: row.lat, lng: row.lng });
  const due =
    onlineChanged ||
    row.synced_at === null ||
    moved >= SYNC_MIN_MOVE_METERS ||
    tx.now - row.synced_at >= SYNC_MIN_INTERVAL_MS;
  if (!due) return { row };

  await syncDriverTracking(tx, row, providerEta);
  const synced = await tx.query<DriverLocationRow>(
    `UPDATE driver_locations SET synced_lat = lat, synced_lng = lng, synced_at = $2 WHERE driver_id = $1
     RETURNING ${LOCATION_COLUMNS}`,
    [uid, new Date(tx.now)],
  );
  return { row: synced.rows[0] ?? row };
}

/**
 * The live fields of every trip the driver is driving (`in_transit`, `arrived`): position, heading, the
 * class-speed ETA, and a `tracking.eta` provider refresh when one is due. The tracking row is re-checked
 * under its lock: a trip that a delivery transaction moved out of the live phase meanwhile is left alone.
 */
async function syncDriverTracking(tx: Tx, location: DriverLocationRow, providerEta: boolean): Promise<void> {
  const { rows: trips } = await tx.query<{
    id: string;
    status: string;
    lat: number;
    lng: number;
    capacity_class: VehicleClass | null;
  }>(
    `SELECT d.id, d.status, (d.doc #>> '{location,lat}')::float8 AS lat, (d.doc #>> '{location,lng}')::float8 AS lng,
            u.capacity_class
       FROM deliveries d JOIN users u ON u.id = d.driver_id
      WHERE d.driver_id = $1 AND d.status IN ('in_transit', 'arrived')`,
    [location.driver_id],
  );
  if (trips.length === 0) return;
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));

  for (const tracking of await lockTrackingByDelivery(tx, [...tripById.keys()])) {
    const trip = tripById.get(tracking.delivery_id)!;
    // Under the lock: the document's status is the committed one (delivery transactions write it).
    const status = tracking.doc.status;
    if ((status !== 'in_transit' && status !== 'arrived') || tracking.doc.driver === null) continue;
    // The delivery may have changed hands since the plain read above.
    const { rows: current } = await tx.query<{ driver_id: string | null }>(
      'SELECT driver_id FROM deliveries WHERE id = $1',
      [trip.id],
    );
    if (current[0]?.driver_id !== location.driver_id) continue;

    const position = { lat: location.lat, lng: location.lng };
    const estimate = estimateEta(position, { lat: trip.lat, lng: trip.lng }, trip.capacity_class);
    const providerFresh =
      tracking.eta_computed_at !== null && tx.now - tracking.eta_computed_at < PROVIDER_ETA_INTERVAL_MS;
    await patchTracking(tx, tracking, {
      driver: {
        ...tracking.doc.driver,
        location: position,
        heading: location.heading,
        updatedAt: location.updated_at,
      },
      // A traffic-aware ETA younger than a minute is kept; otherwise the estimate from the new position.
      ...(status === 'arrived'
        ? { etaSeconds: 0, distanceMeters: estimate.distanceMeters }
        : providerFresh
          ? {}
          : { etaSeconds: estimate.etaSeconds, distanceMeters: estimate.distanceMeters }),
    });
    if (status === 'in_transit' && providerEta && !providerFresh) {
      await enqueue(tx, 'tracking.eta', { deliveryId: trip.id }, { dedupeKey: `tracking.eta:${trip.id}` });
    }
  }
}
