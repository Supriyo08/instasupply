/**
 * Writers of new and cancelled deliveries (docs/PLATFORM.md §9.1). `stageMarketplaceDelivery` is what
 * `placeOrder`, `acceptQuote` and replacement orders call per delivery store order; `stageNewDelivery` is
 * the manual delivery of `createDeliveries`; `stageDeliveryCancellation` is the cascade of a rejected or
 * cancelled store order. All run inside the caller's transaction.
 */
import {
  canTransition,
  driverOffer,
  statusLabel,
  type ActorRole,
  type Delivery,
  type DeliveryInput,
  type DriverPayout,
  type LatLng,
  type StoreOrder,
} from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { failedPrecondition } from '../../platform/http/errors';
import { newHandoffCode, newId, newTrackingToken } from '../../platform/ids';
import { deleteJobOffer } from '../jobs/offers';
import { syncTracking } from '../tracking';
import {
  insertDelivery,
  insertEvent,
  saveDelivery,
  type DeliveryMeta,
  type EventActorShape,
} from './repository';

/**
 * Who caused a delivery event: the person with their role, or `system` for schedules and cascades
 * (MARKETPLACE §2.3). Any of these namings is accepted: `{ id, name, role }`, `{ uid, name, role }` (an
 * order placer) or the event's own field names `{ actorId, actorName, actorRole }` (a resolved store-order
 * actor). Other keys are ignored; without an id the actor is `system`.
 */
export interface EventActorFields {
  id?: string | null;
  uid?: string | null;
  name?: string | null;
  role?: ActorRole | null;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: ActorRole | null;
}
export type EventActor = EventActorFields | object;

export const SYSTEM_ACTOR: EventActorShape = { id: null, name: 'InstaSupply', role: 'system' };

const ROLES: readonly string[] = ['admin', 'dispatcher', 'driver', 'customer', 'supplier', 'system'];
const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** The event's actor fields from any naming of `EventActor`. */
export function eventActorShape(actor: EventActor): EventActorShape {
  const fields = actor as Record<string, unknown>;
  const id = textOf(fields.id) ?? textOf(fields.uid) ?? textOf(fields.actorId);
  const rawRole = textOf(fields.role) ?? textOf(fields.actorRole);
  const role = (
    rawRole && ROLES.includes(rawRole) ? rawRole : id === null ? 'system' : 'system'
  ) as ActorRole;
  return {
    id,
    name: textOf(fields.name) ?? textOf(fields.actorName) ?? (role === 'system' ? 'InstaSupply' : null),
    role,
  };
}

/** The signed-in caller as an event actor. */
export function eventActorOf(actor: { uid: string; name: string; role: ActorRole | null }): EventActorShape {
  return { id: actor.uid, name: actor.name || null, role: actor.role ?? 'system' };
}

/**
 * One delivery of a checkout (MARKETPLACE §5.5.1): call it right after inserting the store order it
 * fulfils (the delivery references it). Everything the driver needs is copied from the store order, the
 * store row (city, private loading notes) and the frozen payout.
 */
export interface MarketplaceDeliveryInput {
  /**
   * Optional pre-generated id (UUIDv4), so the store order document can carry `deliveryId` when it is
   * inserted. A new id is generated when it is left out.
   */
  deliveryId?: string;
  /** The store order as inserted: fulfilment `delivery`, with jobsite, window, timing, load and unload. */
  storeOrder: StoreOrder;
  /**
   * The driver's pay fixed at checkout (`driverOffer`, MARKETPLACE §3.3); boost and wait start at 0. When
   * left out it is computed here with `driverOffer(vehicleClass, roadTenths, load)` of the store order.
   */
  payout?: DriverPayout;
  /** The store's priced part of the checkout; only `roadTenths` is read (for the payout). */
  priced?: { roadTenths?: number | null };
  /** The store row's fields, when the caller has them; otherwise they are read in the transaction. */
  store?: { cityId?: string | null; [field: string]: unknown };
  /** The store's private settings, when the caller has them (`loadingNotes` is copied for the driver). */
  settings?: { loadingNotes?: string | null } | null;
  /** Who placed the order: the customer, or staff for a replacement. Becomes `createdBy` and the event's actor. */
  actor: EventActor;
  /** Other keys a caller passes (`order`, `now`) are ignored: the transaction's clock is `tx.now`. */
  [field: string]: unknown;
}

export async function stageMarketplaceDelivery(
  tx: Tx,
  input: MarketplaceDeliveryInput,
): Promise<{ deliveryId: string; trackingToken: string }> {
  const so = input.storeOrder;
  const actor = eventActorShape(input.actor);
  const jobsite = so.jobsite;
  if (so.fulfilment !== 'delivery' || !jobsite) {
    throw new Error(`stageMarketplaceDelivery: ${so.id} is not a delivery store order`);
  }
  let store: { city_id: string | null; loading_notes: string | null } | undefined;
  if (input.store?.cityId && input.settings !== undefined) {
    store = { city_id: input.store.cityId, loading_notes: input.settings?.loadingNotes ?? null };
  } else {
    const { rows } = await tx.query<{ city_id: string | null; loading_notes: string | null }>(
      `SELECT doc->>'cityId' AS city_id, settings->>'loadingNotes' AS loading_notes FROM stores WHERE id = $1`,
      [so.storeId],
    );
    store = rows[0];
  }
  const vehicleClass = so.vehicleClass ?? so.load.vehicleClass;
  if (!vehicleClass) throw new Error(`stageMarketplaceDelivery: ${so.id} has no vehicle class`);
  const roadTenths = input.priced?.roadTenths ?? Math.round((so.roadKm ?? 0) * 10);
  const payout = input.payout ?? driverOffer(vehicleClass, roadTenths, so.load);
  const now = tx.now;
  const id = input.deliveryId ?? newId();
  const meta: DeliveryMeta = {
    trackingToken: newTrackingToken(),
    handoffCode: newHandoffCode(),
    codeAttempts: 0,
    trackingLinkSentAt: null,
  };
  const notes = [jobsite.instructions, so.instructions].filter((text): text is string => !!text);
  const cityIds = [...new Set([store?.city_id ?? jobsite.cityId, jobsite.cityId])] as Delivery['cityIds'];
  const contact = so.siteContact ?? { name: so.customerName, phone: so.customerPhone };
  const window = so.window;
  const delivery: Delivery = {
    id,
    orderId: so.number,
    kind: 'marketplace',
    storeOrderId: so.id,
    storeId: so.storeId,
    customer: { name: contact.name, phone: contact.phone, email: null },
    address: jobsite.addressLine,
    location: jobsite.location,
    addressNotes: notes.length > 0 ? notes.join('\n') : null,
    notes: null,
    packageCount: Math.max(1, so.load.pieces),
    priority: window?.kind === 'scheduled' ? 'normal' : 'high',
    requireCode: so.receiving === 'attended',
    windowStart: window?.startAt ?? null,
    windowEnd: window?.endAt ?? so.timing.deliverBy ?? null,
    driverId: null,
    driverName: null,
    status: 'unassigned',
    attempts: 0,
    declinedBy: [],
    sourceOrderId: so.orderId,
    customerId: so.customerId,
    proof: null,
    failure: null,
    createdBy: actor.id ?? so.customerId,
    updatedBy: actor.id ?? so.customerId,
    createdAt: now,
    updatedAt: now,
    assignedAt: null,
    acceptedAt: null,
    pickedUpAt: null,
    startedAt: null,
    arrivedAt: null,
    deliveredAt: null,
    failedAt: null,
    cancelledAt: null,
    pickup: {
      storeId: so.storeId,
      storeName: so.storeName,
      address: so.storeAddressLine,
      location: so.storeLocation,
      phone: so.storePhone,
      loadingNotes: store?.loading_notes ?? null,
      readyBy: so.timing.readyBy,
      ready: false,
      readyAt: null,
      arrivedAt: null,
      collectedAt: null,
      pickupCode: null,
    },
    load: so.load,
    vehicleClass,
    tripKm: so.roadKm,
    cityIds,
    receiving: so.receiving,
    requirePhoto: true,
    unload: {
      labourer: so.unload.selected,
      required: so.unload.required,
      status: so.unload.selected ? 'needed' : 'not_needed',
      labourerName: null,
      labourerPhone: null,
    },
    payout: { ...payout, boostCents: 0, waitCents: 0, totalCents: payout.offerCents },
    offerStatus: 'held',
    offerOpensAt: null,
    releasedBy: {},
  };
  await insertDelivery(tx, delivery, meta);
  // The tracking row is created by its owner from the delivery and its meta (§9.4).
  await syncTracking(tx, delivery);
  await insertEvent(tx, delivery, actor, {
    type: 'created',
    status: 'unassigned',
    message: so.source === 'replacement' ? 'Replacement order created' : 'Order placed by the customer',
  });
  return { deliveryId: id, trackingToken: meta.trackingToken };
}

/** A manual delivery created by dispatch (`createDeliveries`, no store order, no COD). */
export interface NewDelivery {
  input: DeliveryInput;
  location: LatLng;
  /** `IS-{n}` from nextNumber('order'). */
  orderId: string;
  driver: { id: string; name: string } | null;
  actor: EventActorShape & { id: string };
}

export async function stageNewDelivery(
  tx: Tx,
  input: NewDelivery,
): Promise<Delivery & { trackingToken: string }> {
  const now = tx.now;
  const { input: fields, driver, actor } = input;
  const meta: DeliveryMeta = {
    trackingToken: newTrackingToken(),
    handoffCode: newHandoffCode(),
    codeAttempts: 0,
    trackingLinkSentAt: null,
  };
  const delivery: Delivery = {
    id: newId(),
    orderId: input.orderId,
    kind: 'manual',
    storeOrderId: null,
    storeId: null,
    customer: { name: fields.customerName, phone: fields.customerPhone, email: fields.customerEmail },
    address: fields.address,
    location: input.location,
    addressNotes: fields.addressNotes,
    notes: fields.notes,
    packageCount: fields.packageCount,
    priority: fields.priority,
    requireCode: fields.requireCode,
    windowStart: fields.windowStart,
    windowEnd: fields.windowEnd,
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? null,
    status: driver ? 'assigned' : 'unassigned',
    attempts: 0,
    declinedBy: [],
    sourceOrderId: null,
    customerId: null,
    proof: null,
    failure: null,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: now,
    updatedAt: now,
    assignedAt: driver ? now : null,
    acceptedAt: null,
    pickedUpAt: null,
    startedAt: null,
    arrivedAt: null,
    deliveredAt: null,
    failedAt: null,
    cancelledAt: null,
    pickup: null,
    load: null,
    vehicleClass: null,
    tripKm: null,
    cityIds: [],
    receiving: null,
    requirePhoto: false,
    unload: null,
    payout: null,
    offerStatus: null,
    offerOpensAt: null,
    releasedBy: {},
  };
  await insertDelivery(tx, delivery, meta);
  await syncTracking(tx, delivery);
  await insertEvent(tx, delivery, actor, {
    type: 'created',
    status: 'unassigned',
    message: 'Delivery created',
  });
  if (driver) {
    await insertEvent(tx, delivery, actor, {
      type: 'assigned',
      status: 'assigned',
      fromStatus: 'unassigned',
      message: `Assigned to ${driver.name}`,
    });
  }
  return { ...delivery, trackingToken: meta.trackingToken };
}

/**
 * The cascade of a rejected or cancelled store order (MARKETPLACE §2.3 coupling): the delivery becomes
 * `cancelled` (the `system` row of the table), `offerStatus: 'withdrawn'`, the driver's PIN is cleared and
 * the offer deleted. The driver stays on the document, so the ledger can pay a cancellation after a claim
 * (§3.9) and the driver is told. The caller runs `applyDeliveryEffects(tx, graph, before, returned)`
 * afterwards (§9.2.2 "Always"). An already cancelled delivery is returned unchanged.
 */
export async function stageDeliveryCancellation(
  tx: Tx,
  graph: LockedGraph,
  delivery: Delivery,
  actor: EventActor,
  reason: string,
): Promise<Delivery> {
  const who = eventActorShape(actor);
  if (delivery.status === 'cancelled') {
    await deleteJobOffer(tx, delivery.id);
    return delivery;
  }
  if (!canTransition(delivery.status, 'cancelled', 'system')) {
    failedPrecondition(`A ${statusLabel(delivery.status).toLowerCase()} delivery can't be cancelled.`);
  }
  const next: Delivery = {
    ...delivery,
    status: 'cancelled',
    cancelledAt: tx.now,
    offerStatus: delivery.kind === 'marketplace' ? 'withdrawn' : delivery.offerStatus,
    pickup: delivery.pickup ? { ...delivery.pickup, pickupCode: null } : null,
    updatedBy: who.id,
  };
  const saved = await saveDelivery(tx, graph, next);
  await insertEvent(tx, saved, who, {
    type: 'status',
    status: 'cancelled',
    fromStatus: delivery.status,
    message: reason ? `Cancelled: ${reason}` : 'Cancelled',
  });
  await deleteJobOffer(tx, delivery.id);
  return saved;
}
