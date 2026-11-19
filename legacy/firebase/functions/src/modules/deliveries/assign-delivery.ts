import {
  COLLECTIONS,
  cleanText,
  statusLabel,
  type AssignDeliveryRequest,
  type OkResponse,
  type UserProfile,
} from '@instasupply/shared';

import { db, FieldValue, serverTimestamp } from '../../lib/admin';
import { failedPrecondition } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireStaff, requireString } from '../../lib/guards';
import { deliveryRef, eventActor, getDeliveryInTx, writeEvent } from './repository';

const REASSIGNABLE = new Set([
  'unassigned',
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'arrived',
  'failed',
]);

export const assignDelivery = callable<AssignDeliveryRequest, OkResponse>(
  'assignDelivery',
  async (request) => {
    const actor = requireStaff(request);
    const deliveryId = requireString(request.data?.deliveryId, 'Delivery');
    const driverId =
      typeof request.data?.driverId === 'string' && request.data.driverId ? request.data.driverId : null;
    const note = cleanText(request.data?.note, 300);

    await db.runTransaction(async (tx) => {
      const delivery = await getDeliveryInTx(tx, deliveryId);
      const driverSnap = driverId ? await tx.get(db.collection(COLLECTIONS.users).doc(driverId)) : null;

      if (!REASSIGNABLE.has(delivery.status)) {
        failedPrecondition(`A ${statusLabel(delivery.status).toLowerCase()} delivery can't be reassigned.`);
      }

      let driverName: string | null = null;
      if (driverId) {
        const driver = driverSnap?.data() as UserProfile | undefined;
        if (driver?.role !== 'driver' || driver.status !== 'active') {
          failedPrecondition('That driver is not approved or has been suspended.');
        }
        driverName = driver.displayName;
      }

      if (driverId === delivery.driverId && delivery.status !== 'failed') return; // nothing to do

      const isRetry = delivery.status === 'failed';
      tx.update(deliveryRef(deliveryId), {
        driverId,
        driverName,
        status: driverId ? 'assigned' : 'unassigned',
        assignedAt: driverId ? serverTimestamp() : null,
        // A reassignment starts the driver-side flow again.
        acceptedAt: null,
        pickedUpAt: null,
        startedAt: null,
        arrivedAt: null,
        failure: isRetry ? null : delivery.failure,
        failedAt: isRetry ? null : (delivery.failedAt ?? null),
        attempts: isRetry ? FieldValue.increment(1) : delivery.attempts,
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      });

      const previous = delivery.driverName ? ` (was ${delivery.driverName})` : '';
      writeEvent(tx, { ...delivery, driverId }, eventActor(actor), {
        type: driverId ? 'assigned' : 'unassigned',
        status: driverId ? 'assigned' : 'unassigned',
        fromStatus: delivery.status,
        message: driverId
          ? `${isRetry ? 'Retry assigned' : 'Assigned'} to ${driverName}${previous}${note ? ` — ${note}` : ''}`
          : `Unassigned${previous}${note ? ` — ${note}` : ''}`,
      });
    });

    return { ok: true };
  },
);
