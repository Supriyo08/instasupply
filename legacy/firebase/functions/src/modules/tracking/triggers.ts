import { COLLECTIONS, haversineMeters, toMillis, type DriverLocation } from '@instasupply/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { baseOptions } from '../../lib/functions';
import { syncTrackingForDriver } from './tracking-service';

/** Skip tracking refreshes for GPS jitter: under 15 m of movement and less than 20 s apart. */
const MIN_MOVE_METERS = 15;
const MIN_INTERVAL_MS = 20_000;

export const onDriverLocationWritten = onDocumentWritten(
  { ...baseOptions, document: `${COLLECTIONS.driverLocations}/{driverId}` },
  async (event) => {
    const after = event.data?.after.data() as DriverLocation | undefined;
    if (!after) return;
    const before = event.data?.before.data() as DriverLocation | undefined;

    if (before && before.online === after.online) {
      const moved = haversineMeters(before, after);
      const elapsed = (toMillis(after.updatedAt) ?? 0) - (toMillis(before.updatedAt) ?? 0);
      if (moved < MIN_MOVE_METERS && elapsed < MIN_INTERVAL_MS) return;
    }

    await syncTrackingForDriver(event.params.driverId, after);
  },
);
