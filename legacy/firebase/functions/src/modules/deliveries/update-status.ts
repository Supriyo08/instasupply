/**
 * Every status change goes through these callables so the server can enforce the shared status
 * machine, stamp timestamps, and write the audit trail atomically.
 */
import {
  DECLINE_REASONS,
  DELIVERY_STATUSES,
  FAILURE_REASONS,
  STATUS_TIMESTAMP_FIELD,
  canTransition,
  cleanText,
  declineReasonLabel,
  failureReasonLabel,
  formatCurrency,
  isValidLatLng,
  statusLabel,
  type CompleteDeliveryRequest,
  type DeliveryStatus,
  type OkResponse,
  type UpdateDeliveryStatusRequest,
  type UpdateDeliveryStatusResponse,
} from '@instasupply/shared';

import { db, FieldValue, serverTimestamp } from '../../lib/admin';
import { fail, failedPrecondition, invalidArgument, permissionDenied } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireOperator, requireString, type Actor } from '../../lib/guards';
import {
  SYSTEM_ACTOR,
  deliveriesCol,
  deliveryRef,
  eventActor,
  getDeliveryInTx,
  privateMetaRef,
  writeEvent,
  type DeliveryRecord,
} from './repository';

const MAX_CODE_ATTEMPTS = 5;

function describe(
  to: DeliveryStatus,
  context: { actor: Actor; isDecline: boolean; note: string | null; reason: string | null },
): string {
  const suffix = context.note ? ` — ${context.note}` : '';
  switch (to) {
    case 'accepted':
      return 'Driver accepted the delivery';
    case 'picked_up':
      return 'Package picked up';
    case 'in_transit':
      return 'Driver is on the way';
    case 'arrived':
      return 'Driver arrived at the drop-off';
    case 'unassigned':
      return context.isDecline
        ? `Declined by driver: ${declineReasonLabel(context.reason)}${suffix}`
        : `Unassigned by dispatch${suffix}`;
    case 'failed':
      return `Delivery failed: ${failureReasonLabel(context.reason)}${suffix}`;
    case 'cancelled':
      return `Cancelled by dispatch${suffix}`;
    case 'delivered':
      return `Marked as delivered by dispatch${suffix}`;
    default:
      return `Status changed to ${statusLabel(to)}${suffix}`;
  }
}

function assertOwnership(actor: Actor, delivery: DeliveryRecord) {
  if (!actor.isStaff && delivery.driverId !== actor.uid) {
    permissionDenied('This delivery is not assigned to you.');
  }
}

export const updateDeliveryStatus = callable<UpdateDeliveryStatusRequest, UpdateDeliveryStatusResponse>(
  'updateDeliveryStatus',
  async (request) => {
    const actor = requireOperator(request);
    const deliveryId = requireString(request.data?.deliveryId, 'Delivery');
    const to = request.data?.status;
    if (!to || !DELIVERY_STATUSES.includes(to)) invalidArgument('Unknown status.');
    if (to === 'assigned') invalidArgument('Use assignDelivery to assign a driver.');

    const note = cleanText(request.data?.note, 500);
    const location = isValidLatLng(request.data?.location) ? request.data.location : null;
    const failureReason = request.data?.failureReason ?? null;
    const declineReason = request.data?.declineReason ?? null;
    if (to === 'failed' && !FAILURE_REASONS.some((reason) => reason.id === failureReason)) {
      invalidArgument('Choose why the delivery failed.');
    }

    return db.runTransaction(async (tx) => {
      const delivery = await getDeliveryInTx(tx, deliveryId);
      assertOwnership(actor, delivery);
      const kind = actor.isStaff ? 'staff' : 'driver';
      if (delivery.status === to) return { status: to };

      if (!canTransition(delivery.status, to, kind)) {
        failedPrecondition(
          `A delivery can't go from "${statusLabel(delivery.status)}" to "${statusLabel(to)}".`,
        );
      }
      if (kind === 'driver' && to === 'delivered') {
        failedPrecondition('Complete the delivery with proof of delivery.');
      }

      const isDecline = kind === 'driver' && delivery.status === 'assigned' && to === 'unassigned';
      if (isDecline && !DECLINE_REASONS.some((reason) => reason.id === declineReason)) {
        invalidArgument('Choose why you are declining.');
      }

      // Only one stop can be "on the way" at a time; park any other active trip (reads first).
      const parked =
        kind === 'driver' && to === 'in_transit'
          ? (
              await tx.get(
                deliveriesCol()
                  .where('driverId', '==', actor.uid)
                  .where('status', 'in', ['in_transit', 'arrived']),
              )
            ).docs.filter((doc) => doc.id !== deliveryId)
          : [];

      const update: Record<string, unknown> = {
        status: to,
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      };
      const timestampField = STATUS_TIMESTAMP_FIELD[to];
      if (timestampField) update[timestampField] = serverTimestamp();

      if (to === 'failed') update.failure = { reason: failureReason, note };
      if (to === 'unassigned') {
        Object.assign(update, {
          driverId: null,
          driverName: null,
          assignedAt: null,
          acceptedAt: null,
          pickedUpAt: null,
          startedAt: null,
          arrivedAt: null,
        });
        if (isDecline) update.declinedBy = FieldValue.arrayUnion(actor.uid);
      }
      if (to === 'delivered') {
        update.proof = {
          recipientName: null,
          photoPath: null,
          codeVerified: false,
          codCollected: null,
          note: note ?? 'Marked as delivered by dispatch',
          location: null,
        };
      }
      tx.update(deliveryRef(deliveryId), update);

      for (const doc of parked) {
        tx.update(doc.ref, { status: 'picked_up', updatedBy: actor.uid, updatedAt: serverTimestamp() });
        writeEvent(
          tx,
          { id: doc.id, orderId: doc.get('orderId') as string, driverId: actor.uid },
          SYSTEM_ACTOR,
          {
            type: 'status',
            status: 'picked_up',
            fromStatus: doc.get('status') as DeliveryStatus,
            message: 'Trip paused — the driver started another stop',
          },
        );
      }

      writeEvent(tx, delivery, eventActor(actor, delivery.driverName), {
        type: 'status',
        status: to,
        fromStatus: delivery.status,
        message: describe(to, { actor, isDecline, note, reason: isDecline ? declineReason : failureReason }),
        location,
      });
      return { status: to };
    });
  },
);

export const completeDelivery = callable<CompleteDeliveryRequest, OkResponse>(
  'completeDelivery',
  async (request) => {
    const actor = requireOperator(request);
    const deliveryId = requireString(request.data?.deliveryId, 'Delivery');
    const recipientName = cleanText(request.data?.recipientName, 80);
    const code =
      typeof request.data?.handoffCode === 'string' ? request.data.handoffCode.replace(/\D/g, '') : '';
    const note = cleanText(request.data?.note, 500);
    const location = isValidLatLng(request.data?.location) ? request.data.location : null;

    const rawPhoto = request.data?.photoPath;
    const photoPath =
      typeof rawPhoto === 'string' && rawPhoto.startsWith(`proofs/${deliveryId}/`) && !rawPhoto.includes('..')
        ? rawPhoto
        : null;
    if (rawPhoto && !photoPath) invalidArgument('The proof photo is invalid. Please retake it.');

    const rawCod = request.data?.codCollected;
    const codCollected =
      typeof rawCod === 'number' && Number.isFinite(rawCod) && rawCod >= 0
        ? Math.round(rawCod * 100) / 100
        : null;

    const outcome = await db.runTransaction(async (tx) => {
      const delivery = await getDeliveryInTx(tx, deliveryId);
      const metaRef = privateMetaRef(deliveryId);
      const meta = await tx.get(metaRef);
      assertOwnership(actor, delivery);
      const kind = actor.isStaff ? 'staff' : 'driver';

      if (delivery.status === 'delivered') return { ok: true as const };
      if (!canTransition(delivery.status, 'delivered', kind)) {
        failedPrecondition(`This delivery can't be completed while it is "${statusLabel(delivery.status)}".`);
      }
      if (kind === 'driver' && !recipientName && !photoPath) {
        invalidArgument("Add the recipient's name or a photo as proof of delivery.");
      }
      if (kind === 'driver' && delivery.codAmount && codCollected == null) {
        invalidArgument(`Confirm the cash collected (${formatCurrency(delivery.codAmount)}).`);
      }

      let codeVerified = false;
      if (delivery.requireCode && kind === 'driver') {
        const attempts = (meta.get('codeAttempts') as number | undefined) ?? 0;
        if (attempts >= MAX_CODE_ATTEMPTS) return { error: 'locked' as const };
        if (!code || code !== meta.get('handoffCode')) {
          tx.update(metaRef, { codeAttempts: attempts + 1 });
          return { error: 'wrong_code' as const, remaining: MAX_CODE_ATTEMPTS - attempts - 1 };
        }
        codeVerified = true;
        tx.update(metaRef, { codeAttempts: 0 });
      }

      tx.update(deliveryRef(deliveryId), {
        status: 'delivered',
        deliveredAt: serverTimestamp(),
        proof: { recipientName, photoPath, codeVerified, codCollected, note, location },
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      });
      const details = [
        recipientName ? `to ${recipientName}` : null,
        codeVerified ? 'code verified' : null,
        codCollected != null ? `${formatCurrency(codCollected)} collected` : null,
      ].filter(Boolean);
      writeEvent(tx, delivery, eventActor(actor, delivery.driverName), {
        type: 'status',
        status: 'delivered',
        fromStatus: delivery.status,
        message: `Delivered${details.length ? ` (${details.join(', ')})` : ''}`,
        location,
      });
      return { ok: true as const };
    });

    if ('error' in outcome) {
      if (outcome.error === 'locked') {
        fail('resource-exhausted', 'Too many incorrect codes. Ask dispatch to complete this delivery.');
      }
      invalidArgument(
        `That hand-off code is incorrect. ${outcome.remaining} attempt${outcome.remaining === 1 ? '' : 's'} left.`,
      );
    }
    return { ok: true };
  },
);
