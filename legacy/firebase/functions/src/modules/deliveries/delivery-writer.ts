/**
 * Stages every document a new delivery needs (delivery, private meta, tracking page, audit
 * events) on a batch or transaction. Used by dispatch (`createDeliveries`) and by customer orders
 * (`placeOrder`) so both produce identical deliveries.
 */
import type { DeliveryInput, LatLng } from '@instasupply/shared';
import type { DocumentReference, Transaction, WriteBatch } from 'firebase-admin/firestore';

import { serverTimestamp, Timestamp } from '../../lib/admin';
import { newHandoffCode, newTrackingToken } from '../../lib/ids';
import {
  deliveriesCol,
  privateMetaRef,
  trackingRef,
  writeEvent,
  type EventActor,
} from './repository';

export interface NewDelivery {
  input: DeliveryInput;
  location: LatLng;
  /** Human reference, e.g. IS-10042. */
  orderId: string;
  driver: { id: string; name: string } | null;
  /** Who created it; `id` becomes createdBy/updatedBy. */
  actor: EventActor & { id: string };
  /** Set when the delivery fulfils a customer order. */
  sourceOrderId?: string | null;
  customerId?: string | null;
}

export function stageNewDelivery(
  writer: Transaction | WriteBatch,
  delivery: NewDelivery,
): { id: string; trackingToken: string } {
  const { input, location, orderId, driver, actor } = delivery;
  const ref = deliveriesCol().doc();
  const trackingToken = newTrackingToken();
  const status = driver ? 'assigned' : 'unassigned';
  // Transaction.set and WriteBatch.set share this signature.
  const set = (target: DocumentReference, data: Record<string, unknown>) =>
    (writer as WriteBatch).set(target, data);

  set(ref, {
    orderId,
    customer: { name: input.customerName, phone: input.customerPhone, email: input.customerEmail },
    address: input.address,
    location,
    addressNotes: input.addressNotes,
    notes: input.notes,
    packageCount: input.packageCount,
    priority: input.priority,
    codAmount: input.codAmount,
    requireCode: input.requireCode,
    windowStart: input.windowStart ? Timestamp.fromMillis(input.windowStart) : null,
    windowEnd: input.windowEnd ? Timestamp.fromMillis(input.windowEnd) : null,
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? null,
    status,
    attempts: 0,
    proof: null,
    failure: null,
    sourceOrderId: delivery.sourceOrderId ?? null,
    customerId: delivery.customerId ?? null,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    assignedAt: driver ? serverTimestamp() : null,
  });
  set(privateMetaRef(ref.id), { trackingToken, handoffCode: newHandoffCode(), codeAttempts: 0 });
  set(trackingRef(trackingToken), { deliveryId: ref.id, orderId, status, updatedAt: serverTimestamp() });

  const summary = { id: ref.id, orderId, driverId: driver?.id ?? null };
  writeEvent(writer, summary, actor, {
    type: 'created',
    status: 'unassigned',
    message: delivery.sourceOrderId ? 'Order placed by the customer' : 'Delivery created',
  });
  if (driver) {
    writeEvent(writer, summary, actor, {
      type: 'assigned',
      status: 'assigned',
      fromStatus: 'unassigned',
      message: `Assigned to ${driver.name}`,
    });
  }
  return { id: ref.id, trackingToken };
}
