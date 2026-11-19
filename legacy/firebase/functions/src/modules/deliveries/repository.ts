/**
 * Firestore access for deliveries: references, typed reads and audit events.
 */
import {
  COLLECTIONS,
  isValidLatLng,
  PRIVATE_META_DOC,
  type ActorRole,
  type Delivery,
  type DeliveryEventType,
  type DeliveryPrivateMeta,
  type DeliveryStatus,
  type LatLng,
} from '@instasupply/shared';
import type { Transaction, WriteBatch } from 'firebase-admin/firestore';

import { db, serverTimestamp } from '../../lib/admin';
import { notFound } from '../../lib/errors';
import type { Actor } from '../../lib/guards';

export type DeliveryRecord = Delivery;
export type DeliveryData = Omit<Delivery, 'id'>;

/**
 * Deliveries are only created by `createDeliveries`, but a hand edit in the console (or a test
 * fixture) can leave a partial document. Side effects skip those instead of crashing.
 */
export function isCompleteDelivery(
  delivery: Partial<DeliveryRecord> | null | undefined,
): delivery is DeliveryRecord {
  return (
    !!delivery &&
    typeof delivery.orderId === 'string' &&
    typeof delivery.customer?.name === 'string' &&
    typeof delivery.address === 'string' &&
    isValidLatLng(delivery.location)
  );
}

export const deliveriesCol = () => db.collection(COLLECTIONS.deliveries);
export const deliveryRef = (id: string) => deliveriesCol().doc(id);
export const privateMetaRef = (id: string) =>
  deliveryRef(id).collection(COLLECTIONS.private).doc(PRIVATE_META_DOC);
export const eventsCol = (id: string) => deliveryRef(id).collection(COLLECTIONS.events);
export const trackingRef = (token: string) => db.collection(COLLECTIONS.tracking).doc(token);

export async function getDeliveryInTx(tx: Transaction, id: string): Promise<DeliveryRecord> {
  const snapshot = await tx.get(deliveryRef(id));
  if (!snapshot.exists) notFound('This delivery no longer exists.');
  return { id, ...(snapshot.data() as DeliveryData) };
}

export async function getPrivateMeta(id: string): Promise<DeliveryPrivateMeta | null> {
  const snapshot = await privateMetaRef(id).get();
  return snapshot.exists ? (snapshot.data() as DeliveryPrivateMeta) : null;
}

export interface EventInput {
  type: DeliveryEventType;
  message: string;
  status?: DeliveryStatus | null;
  fromStatus?: DeliveryStatus | null;
  location?: LatLng | null;
}

export interface EventActor {
  id: string | null;
  name: string | null;
  role: ActorRole;
}

export const SYSTEM_ACTOR: EventActor = { id: null, name: 'InstaSupply', role: 'system' };

export function eventActor(actor: Actor, fallbackName?: string | null): EventActor {
  return { id: actor.uid, name: actor.name ?? fallbackName ?? null, role: actor.role ?? 'system' };
}

/** Add an audit event in the same transaction/batch as the change it describes. */
export function writeEvent(
  writer: Transaction | WriteBatch,
  delivery: Pick<DeliveryRecord, 'id' | 'orderId' | 'driverId'>,
  actor: EventActor,
  input: EventInput,
): void {
  const ref = eventsCol(delivery.id).doc();
  const data = {
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    driverId: delivery.driverId ?? null,
    type: input.type,
    status: input.status ?? null,
    fromStatus: input.fromStatus ?? null,
    message: input.message,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    location: input.location ?? null,
    at: serverTimestamp(),
  };
  // Transaction.set and WriteBatch.set share this signature.
  (writer as WriteBatch).set(ref, data);
}
