import { COLLECTIONS } from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { managedSecrets, region } from '../../config/runtime';
import { db, Timestamp } from '../../lib/admin';

/** Drivers whose app stopped reporting (crash, no signal, app killed) are marked offline. */
const OFFLINE_AFTER_MS = 10 * 60 * 1000;

export const markStaleDriversOffline = onSchedule(
  { region, secrets: managedSecrets, schedule: 'every 5 minutes', timeoutSeconds: 120, retryCount: 0 },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - OFFLINE_AFTER_MS);
    const stale = await db
      .collection(COLLECTIONS.driverLocations)
      .where('online', '==', true)
      .where('updatedAt', '<', cutoff)
      .limit(400)
      .get();
    if (stale.empty) return;

    const batch = db.batch();
    stale.docs.forEach((doc) => batch.update(doc.ref, { online: false }));
    await batch.commit();
    logger.info('Marked stale drivers offline', { count: stale.size });
  },
);
