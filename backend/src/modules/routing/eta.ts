/**
 * The `tracking.eta` outbox handler (docs/PLATFORM.md §9.3, §9.4): one provider ETA for a trip in transit,
 * at most once per 60 s per delivery. The provider call runs with no transaction open; the result is written
 * under the tracking row lock and dropped when the trip is no longer `in_transit` there, so a delivered trip
 * can never be shown "On the way" again.
 */
import type { Deps } from '../../container';
import { withTransaction } from '../../platform/db/tx';
import { lockTrackingByDelivery, patchTracking } from '../tracking';
import { getLiveDriveSeconds } from './providers';

export interface TrackingEtaPayload {
  deliveryId: string;
}

type EtaDeps = Pick<Deps, 'config' | 'pool' | 'clock' | 'log'>;

/** Returns whether a provider ETA was written. A second run recomputes from the newest position. */
export async function refreshTrackingEta(deps: EtaDeps, deliveryId: string, now: number): Promise<boolean> {
  const { rows } = await deps.pool.query<{
    driver_id: string | null;
    status: string;
    lat: number;
    lng: number;
    from_lat: number | null;
    from_lng: number | null;
  }>(
    `SELECT d.driver_id, d.status, (d.doc #>> '{location,lat}')::float8 AS lat,
            (d.doc #>> '{location,lng}')::float8 AS lng, l.lat AS from_lat, l.lng AS from_lng
       FROM deliveries d LEFT JOIN driver_locations l ON l.driver_id = d.driver_id
      WHERE d.id = $1`,
    [deliveryId],
  );
  const trip = rows[0];
  if (
    !trip ||
    trip.status !== 'in_transit' ||
    !trip.driver_id ||
    trip.from_lat === null ||
    trip.from_lng === null
  ) {
    return false;
  }
  const result = await getLiveDriveSeconds(
    deps,
    { lat: trip.from_lat, lng: trip.from_lng },
    { lat: trip.lat, lng: trip.lng },
  );

  return withTransaction(
    deps,
    async (tx) => {
      const [tracking] = await lockTrackingByDelivery(tx, [deliveryId]);
      if (!tracking || tracking.doc.status !== 'in_transit' || tracking.doc.driver === null) return false;
      // Without a provider answer only the attempt is stamped, so the next one waits its 60 s.
      if (!result) {
        await patchTracking(tx, tracking, {}, { etaComputedAt: tx.now });
        return false;
      }
      await patchTracking(
        tx,
        tracking,
        { etaSeconds: Math.round(result.seconds), distanceMeters: Math.round(result.meters) },
        { etaComputedAt: tx.now },
      );
      return true;
    },
    { now },
  );
}
