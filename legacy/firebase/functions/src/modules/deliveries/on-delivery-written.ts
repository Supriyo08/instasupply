/**
 * Side effects of any delivery change, regardless of who made it (callables, console edits,
 * imports): route re-planning, tracking-page sync, notifications and the customer SMS.
 */
import {
  APP_NAME,
  COLLECTIONS,
  failureReasonLabel,
  firstName,
  isActiveStatus,
  isTerminalStatus,
  toMillis,
} from '@instasupply/shared';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { settings } from '../../config/runtime';
import { db, serverTimestamp } from '../../lib/admin';
import { baseOptions, settleAll } from '../../lib/functions';
import { syncOrderFromDelivery } from '../commerce/order-sync';
import { notifyStaff, notifyUser } from '../notifications/notify';
import { planRouteSafely } from '../routing/planner';
import { sendSms } from '../sms/sms';
import { deleteTrackingForDelivery, syncTracking } from '../tracking/tracking-service';
import {
  SYSTEM_ACTOR,
  isCompleteDelivery,
  privateMetaRef,
  writeEvent,
  type DeliveryData,
  type DeliveryRecord,
} from './repository';

const shortAddress = (address: string) => address.split(',').slice(0, 2).join(',').trim();

function didPlanningInputsChange(before: DeliveryRecord | null, after: DeliveryRecord): boolean {
  if (!before) return true;
  return (
    before.location.lat !== after.location.lat ||
    before.location.lng !== after.location.lng ||
    before.priority !== after.priority ||
    toMillis(before.windowStart) !== toMillis(after.windowStart) ||
    toMillis(before.windowEnd) !== toMillis(after.windowEnd)
  );
}

function didPublicFieldsChange(before: DeliveryRecord | null, after: DeliveryRecord): boolean {
  if (!before) return true;
  return (
    before.status !== after.status ||
    before.driverId !== after.driverId ||
    before.address !== after.address ||
    before.location.lat !== after.location.lat ||
    before.location.lng !== after.location.lng ||
    before.requireCode !== after.requireCode ||
    before.customer.name !== after.customer.name
  );
}

async function notifyChange(eventId: string, before: DeliveryRecord | null, after: DeliveryRecord) {
  const data = { deliveryId: after.id, orderId: after.orderId };
  const summary = `${after.orderId} · ${after.customer.name} · ${shortAddress(after.address)}`;
  const actorId = after.updatedBy;
  const driverChanged = (before?.driverId ?? null) !== after.driverId;
  const jobs: Promise<void>[] = [];
  const key = (suffix: string) => `${eventId}-${suffix}`;

  if (driverChanged) {
    if (after.driverId) {
      jobs.push(
        notifyUser(after.driverId, {
          type: 'delivery_assigned',
          title: after.priority === 'urgent' ? 'Urgent delivery assigned' : 'New delivery assigned',
          body: summary,
          data,
          key: key('assigned'),
        }),
      );
    }
    if (before?.driverId) {
      const declinedByDriver = actorId === before.driverId;
      if (declinedByDriver) {
        jobs.push(
          notifyStaff({
            type: 'delivery_declined',
            title: `${before.driverName ?? 'A driver'} declined ${after.orderId}`,
            body: 'The delivery is back in the unassigned queue.',
            data,
            key: key('declined'),
          }),
        );
      } else if (!isTerminalStatus(after.status)) {
        jobs.push(
          notifyUser(before.driverId, {
            type: 'delivery_unassigned',
            title: 'Delivery removed from your route',
            body: `${after.orderId} for ${after.customer.name} was reassigned by dispatch.`,
            data,
            key: key('unassigned'),
          }),
        );
      }
    }
  }

  if (before && before.status !== after.status && !driverChanged) {
    const byDriver = !!after.driverId && actorId === after.driverId;
    if (after.status === 'cancelled' && after.driverId) {
      jobs.push(
        notifyUser(after.driverId, {
          type: 'delivery_cancelled',
          title: 'Delivery cancelled',
          body: `${after.orderId} for ${after.customer.name} was cancelled. You don't need to deliver it.`,
          data,
          key: key('cancelled'),
        }),
      );
    } else if (after.status === 'failed' && byDriver) {
      jobs.push(
        notifyStaff({
          type: 'delivery_failed',
          title: `${after.orderId} could not be delivered`,
          body: `${after.driverName ?? 'Driver'}: ${failureReasonLabel(after.failure?.reason)}`,
          data,
          key: key('failed'),
        }),
      );
    } else if (after.status === 'delivered' && byDriver) {
      jobs.push(
        notifyStaff({
          type: 'delivery_delivered',
          title: `${after.orderId} delivered`,
          body: `${after.driverName ?? 'The driver'} completed the delivery to ${after.customer.name}.`,
          data,
          silent: true,
          key: key('delivered'),
        }),
      );
    } else if (!byDriver && after.driverId && isTerminalStatus(after.status)) {
      jobs.push(
        notifyUser(after.driverId, {
          type: 'delivery_updated',
          title: `${after.orderId} was updated by dispatch`,
          body: `The delivery is now marked as ${after.status}.`,
          data,
          key: key('status'),
        }),
      );
    }
  }

  const detailsEditedByStaff =
    before &&
    !driverChanged &&
    after.driverId &&
    isActiveStatus(after.status) &&
    actorId !== after.driverId &&
    (before.address !== after.address ||
      before.addressNotes !== after.addressNotes ||
      before.notes !== after.notes ||
      before.customer.phone !== after.customer.phone);
  if (detailsEditedByStaff) {
    jobs.push(
      notifyUser(after.driverId!, {
        type: 'delivery_updated',
        title: `${after.orderId} details changed`,
        body: 'Dispatch updated this delivery. Check the latest address and notes.',
        data,
        key: key('edited'),
      }),
    );
  }

  await Promise.all(jobs);
}

/** Text the customer their live tracking link once, when the driver starts the trip. */
async function sendTrackingLinkOnce(delivery: DeliveryRecord) {
  const phone = delivery.customer.phone;
  if (!phone) return;
  const metaRef = privateMetaRef(delivery.id);
  const token = await db.runTransaction(async (tx) => {
    const meta = await tx.get(metaRef);
    if (!meta.exists || meta.get('trackingLinkSentAt')) return null;
    tx.update(metaRef, { trackingLinkSentAt: serverTimestamp() });
    return meta.get('trackingToken') as string;
  });
  if (!token) return;

  const link = `${settings.trackingBaseUrl}/track/${token}`;
  const channel = await sendSms({
    to: phone,
    purpose: 'tracking_link',
    body: `${APP_NAME}: Hi ${firstName(delivery.customer.name)}, your order ${delivery.orderId} is on the way with ${firstName(delivery.driverName)}. Track it live: ${link}`,
  });

  const batch = db.batch();
  writeEvent(batch, delivery, SYSTEM_ACTOR, {
    type: 'customer_notified',
    message:
      channel === 'sent'
        ? 'Tracking link sent to the customer by SMS'
        : 'Tracking link queued in the dev outbox',
  });
  await batch.commit();
}

export const onDeliveryWritten = onDocumentWritten(
  { ...baseOptions, document: `${COLLECTIONS.deliveries}/{deliveryId}` },
  async (event) => {
    const deliveryId = event.params.deliveryId;
    const read = (snapshot: DocumentSnapshot | undefined): DeliveryRecord | null =>
      snapshot?.exists ? { id: deliveryId, ...(snapshot.data() as DeliveryData) } : null;
    const previous = read(event.data?.before);
    const after = read(event.data?.after);

    if (!after) {
      await settleAll('onDeliveryDeleted', [
        deleteTrackingForDelivery(deliveryId),
        ...(previous?.driverId ? [planRouteSafely(previous.driverId)] : []),
      ]);
      return;
    }
    if (!isCompleteDelivery(after)) {
      logger.warn('Skipping side effects for an incomplete delivery document', { deliveryId });
      return;
    }
    // An incomplete previous version is treated like a fresh document.
    const before = isCompleteDelivery(previous) ? previous : null;

    // 1. Re-plan affected routes first, so the tracking page can show the stop position and ETA.
    const driverChanged = (before?.driverId ?? null) !== after.driverId;
    const statusChanged = before?.status !== after.status;
    const affectedDrivers = new Set<string>();
    if (driverChanged) {
      if (before?.driverId) affectedDrivers.add(before.driverId);
      if (after.driverId) affectedDrivers.add(after.driverId);
    } else if (after.driverId && (statusChanged || didPlanningInputsChange(before, after))) {
      affectedDrivers.add(after.driverId);
    }
    await Promise.all([...affectedDrivers].map(planRouteSafely));

    // 2. Everything else can run in parallel.
    const tasks: Promise<unknown>[] = [
      notifyChange(event.id, before, after),
      syncOrderFromDelivery(event.id, before, after),
    ];
    if (didPublicFieldsChange(before, after) || affectedDrivers.size > 0) tasks.push(syncTracking(after));
    if (statusChanged && after.status === 'in_transit') tasks.push(sendTrackingLinkOnce(after));
    await settleAll('onDeliveryWritten', tasks);
  },
);
