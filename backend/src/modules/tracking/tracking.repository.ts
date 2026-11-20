/**
 * The `tracking` and `driver_locations` tables (docs/PLATFORM.md §3.2, §3.3). `tracking.doc` is the
 * PublicTracking document without `updatedAt`; four writers own disjoint fields of it (§9.4) and each writes
 * only its own fields, under the row lock, with `doc || patch`.
 */
import type { DriverLocation, PublicTracking, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

export type TrackingDoc = Omit<PublicTracking, 'updatedAt'>;

export type TrackingRow = {
  token: string;
  delivery_id: string;
  doc: TrackingDoc;
  eta_computed_at: number | null;
  updated_at: number;
};

export const toPublicTracking = (row: Pick<TrackingRow, 'doc' | 'updated_at'>): PublicTracking => ({
  ...row.doc,
  updatedAt: row.updated_at,
});

/** The public token format of GET /tracking/{token} (the URL-safe alphabet of `newTrackingToken`). */
export const TRACKING_TOKEN = /^[A-Za-z0-9_-]{12,64}$/;

export async function findTrackingByToken(db: Queryable, token: string): Promise<PublicTracking | null> {
  const { rows } = await db.query<TrackingRow>('SELECT doc, updated_at FROM tracking WHERE token = $1', [
    token,
  ]);
  const row = rows[0];
  return row ? toPublicTracking(row) : null;
}

/** Locks the tracking rows of these deliveries in token order (rank 15, after every business row). */
export async function lockTrackingByDelivery(tx: Tx, deliveryIds: readonly string[]): Promise<TrackingRow[]> {
  if (deliveryIds.length === 0) return [];
  const { rows } = await tx.query<TrackingRow>(
    `SELECT token, delivery_id, doc, eta_computed_at, updated_at FROM tracking
      WHERE delivery_id = ANY($1::text[]) ORDER BY token COLLATE "C" FOR NO KEY UPDATE`,
    [deliveryIds],
  );
  return rows;
}

/**
 * Writes a partial patch of top-level fields onto a locked tracking row, stamps `updated_at = tx.now` and
 * publishes the whole document on `tracking:{token}`. A patch that changes nothing writes nothing (only
 * `eta_computed_at`, when given).
 */
export async function patchTracking(
  tx: Tx,
  row: TrackingRow,
  patch: Partial<TrackingDoc>,
  opts: { etaComputedAt?: number } = {},
): Promise<TrackingRow> {
  const changed = (Object.keys(patch) as (keyof TrackingDoc)[]).some(
    (key) => JSON.stringify(row.doc[key] ?? null) !== JSON.stringify(patch[key] ?? null),
  );
  if (!changed && opts.etaComputedAt === undefined) return row;
  const { rows } = await tx.query<TrackingRow>(
    `UPDATE tracking SET doc = doc || $2::jsonb, updated_at = CASE WHEN $5 THEN $3 ELSE updated_at END,
            eta_computed_at = COALESCE($4, eta_computed_at)
      WHERE token = $1
      RETURNING token, delivery_id, doc, eta_computed_at, updated_at`,
    [
      row.token,
      JSON.stringify(changed ? patch : {}),
      new Date(tx.now),
      opts.etaComputedAt === undefined ? null : new Date(opts.etaComputedAt),
      changed,
    ],
  );
  const next = rows[0] ?? row;
  if (changed) await publishTracking(tx, next);
  return next;
}

export async function publishTracking(
  tx: Tx,
  row: Pick<TrackingRow, 'token' | 'doc' | 'updated_at'>,
): Promise<void> {
  await publishChange(tx, 'tracking', 'updated', { token: row.token, ...toPublicTracking(row) });
}

// ---------- driver_locations ----------

export type DriverLocationRow = {
  driver_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  battery: number | null;
  online: boolean;
  synced_lat: number | null;
  synced_lng: number | null;
  synced_at: number | null;
  updated_at: number;
};

export const LOCATION_COLUMNS =
  'driver_id, lat, lng, heading, speed, accuracy, battery, online, synced_lat, synced_lng, synced_at, updated_at';

export const toDriverLocation = (row: DriverLocationRow): WithId<DriverLocation> => ({
  id: row.driver_id,
  lat: row.lat,
  lng: row.lng,
  heading: row.heading,
  speed: row.speed,
  accuracy: row.accuracy,
  online: row.online,
  battery: row.battery,
  updatedAt: row.updated_at,
});

export async function findDriverLocation(db: Queryable, driverId: string): Promise<DriverLocationRow | null> {
  const { rows } = await db.query<DriverLocationRow>(
    `SELECT ${LOCATION_COLUMNS} FROM driver_locations WHERE driver_id = $1`,
    [driverId],
  );
  return rows[0] ?? null;
}

export async function publishDriverLocation(tx: Tx, row: DriverLocationRow): Promise<void> {
  const { id, ...location } = toDriverLocation(row);
  await publishChange(tx, 'driver_locations', 'updated', { driverId: id, ...location });
}
