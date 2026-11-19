/**
 * Marketplace order contracts (§1.3): jobsites, the cart, the checkout receipt (`orders`), each
 * store's part of it (`storeOrders`) and the payment record. Below them, the store-order machine
 * (§2.1) and what an order derives from its store orders: status, headline, settled (§2.2).
 *
 * One checkout writes one order, one store order per store and, for delivery, one delivery per store
 * order (D1). Money is whole CAD cents in fields ending `Cents`; instants end in `At` (§1.1).
 */
import type { CardBrand } from './cards';
import type { CategoryId, DimsCm, PostalAddress, SellUnit } from './catalog';
import type { CityId } from './market';
import { transitionTargets, type MachineActor, type StatusTone, type TransitionRule } from './status';
import type { ActorRole, LatLng, TimestampLike } from './types';
import type { LoadSummary, VehicleClass } from './vehicles';

// ---------- jobsites and the cart ----------

export type Fulfilment = 'delivery' | 'pickup';

/**
 * `attended`: someone on site receives the load and gives the driver the hand-off code.
 * `unattended`: nobody is on site, and the drop-off photo alone proves the delivery.
 */
export type Receiving = 'attended' | 'unattended';

export interface Contact {
  name: string;
  phone: string;
}

export interface JobsiteFields extends PostalAddress {
  /** The customer's name for the site, e.g. "Leslieville semi reno". */
  label: string;
  /** Required: the customer drops a pin, because new builds often have no civic address yet. */
  location: LatLng;
  cityId: CityId;
  /** Neighbourhood and postal prefix, e.g. "Leslieville · M4M". Safe to show drivers before a claim. */
  areaLabel: string;
  contactName: string;
  contactPhone: string;
  /** Gate code, where to stack. */
  instructions: string | null;
  receiving: Receiving;
  /** Largest vehicle that fits the site ("narrow lane: cargo van max"); null when there is no limit. */
  maxVehicleClass: VehicleClass | null;
}

/** `users/{uid}/jobsites/{jobsiteId}` (replaces saved addresses). */
export interface Jobsite extends JobsiteFields {
  id: string;
  isDefault: boolean;
  /** Written by `placeOrder`; clients cannot set it. */
  lastUsedAt: TimestampLike | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** The jobsite as it was at checkout: later edits never change an order. */
export type JobsiteSnapshot = JobsiteFields & { jobsiteId: string | null; addressLine: string };

/** One line of the device cart (`instasupply.cart.v2`): it carries its store (D18). */
export interface CartLine {
  productId: string;
  storeId: string;
  quantity: number;
}

/** `carts/{uid}`: the signed-in cart, same shape as the device cart. Syncing it is P1 (D18). */
export interface Cart {
  lines: CartLine[];
  promoCode: string | null;
  unloadHelpStoreIds: string[];
  fulfilment: Fulfilment;
  jobsiteId: string | null;
  updatedAt: TimestampLike;
}

// ---------- amounts ----------

export interface DeliveryWindow {
  /** `asap`, or the slot start as a Toronto time: `2026-11-20T07:00`. */
  id: string;
  kind: 'asap' | 'scheduled';
  /** Toronto date, `YYYY-MM-DD`. */
  date: string;
  /** Null for ASAP. */
  startAt: TimestampLike | null;
  /** Deliver by. */
  endAt: TimestampLike;
  /** "Today by 1:50 pm". */
  label: string;
}

/**
 * The amounts every receipt shows (§3.4 step 7):
 * `totalCents = itemsCents − discountCents + deliveryFeeCents + unloadFeeCents + taxCents`.
 */
export interface Amounts {
  itemsCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  unloadFeeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface AppliedDiscount {
  kind: 'first_order' | 'promo';
  code: string | null;
  label: string;
  cents: number;
}

// ---------- orders ----------

/** Derived from the store orders, never set directly: the order follows its slowest store (§2.2). */
export type OrderStatus =
  'placed' | 'confirmed' | 'preparing' | 'ready' | 'on_the_way' | 'completed' | 'cancelled';

/** Card only: authorized at checkout, captured once when every store order is settled (D6, §2.7). */
export type PaymentStatus =
  | 'authorized'
  | 'capture_pending'
  | 'captured'
  | 'capture_failed'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'
  | 'not_required';

export interface PaymentEvent {
  type: 'authorize' | 'void' | 'capture' | 'capture_failed' | 'release' | 'refund';
  amountCents: number;
  storeOrderId: string | null;
  issueId: string | null;
  /** The gateway's reference. */
  ref: string;
  idempotencyKey: string;
  reason: string | null;
  at: TimestampLike;
}

export interface OrderPayment {
  /** `none`: a replacement order, nothing to pay. */
  method: 'card' | 'none';
  provider: 'test' | 'stripe';
  intentRef: string | null;
  /** Brand and last 4 only: card numbers are never stored. */
  card: { cardId: string; brand: CardBrand; last4: string } | null;
  status: PaymentStatus;
  authorizedCents: number;
  capturedCents: number;
  refundedCents: number;
  /** Set while a capture is in flight, so a crash can retry the same amount. */
  pendingCaptureCents: number;
  /** Each store order's `current.totalCents` at capture. */
  capturedByStoreOrder: Record<string, number>;
  /** Issue refunds per store order. */
  refundedByStoreOrder: Record<string, number>;
  /** Automatic refunds (`refund_adj_…`) per store order, for amounts that dropped after the capture. */
  adjustedByStoreOrder: Record<string, number>;
  authorizedAt: TimestampLike | null;
  /** `min(authorizedAt + 6 days, the gateway's captureBefore − 6 h)`. */
  captureDeadlineAt: TimestampLike | null;
  capturedAt: TimestampLike | null;
  /** At most 30. */
  events: PaymentEvent[];
}

/** A store order as the customer's order document lists it. Kept fresh by `syncOrderAggregate`. */
export interface StoreOrderSummary {
  storeOrderId: string;
  number: string;
  letter: string;
  storeId: string;
  storeName: string;
  fulfilment: Fulfilment;
  status: StoreOrderStatus;
  itemCount: number;
  itemsSummary: string;
  currentTotalCents: number;
  deliverBy: TimestampLike | null;
  readyAt: TimestampLike | null;
  holdUntil: TimestampLike | null;
  /** Lives here, not on the store order: suppliers must not be able to read it. */
  trackingToken: string | null;
  /** Pickup only: the PIN the customer shows at the counter. Suppliers never see it. */
  pickupCode: string | null;
  driverFirstName: string | null;
  updatedAt: TimestampLike;
}

/**
 * `orders/{orderId}`: the checkout receipt, the payment and the overall status. The id is the client's
 * `checkoutId`, so a retried checkout never creates a second order or charge (D17).
 */
export interface Order {
  id: string;
  /** `IS-10042`. */
  number: string;
  source: 'cart' | 'quote' | 'replacement';
  quoteId: string | null;
  issueId: string | null;
  customerId: string;
  customerName: string;
  companyName: string | null;
  customerPhone: string;
  fulfilment: Fulfilment;
  jobsite: JobsiteSnapshot | null;
  receiving: Receiving | null;
  siteContact: Contact | null;
  window: DeliveryWindow | null;
  instructions: string | null;
  storeOrderIds: string[];
  storeCount: number;
  lineCount: number;
  itemCount: number;
  itemsSummary: string;
  /** The checkout receipt. Never changes after placement. */
  placed: Amounts & {
    discounts: AppliedDiscount[];
    promoCode: string | null;
    freeDelivery: 'first_order' | 'free_threshold' | null;
  };
  /** What the customer will really pay: the sum of the store orders' `current`. */
  current: Amounts;
  payment: OrderPayment;
  /** Projection written by `syncOrderAggregate`. */
  storeOrders: StoreOrderSummary[];
  status: OrderStatus;
  statusAt: Partial<Record<OrderStatus, TimestampLike>>;
  /** Any store order failed or was not accepted in time. */
  needsAttention: boolean;
  isFirstOrder: boolean;
  /**
   * True while the order is counted in the customer's `stats.nonCancelledOrders`. If the order ends
   * cancelled the count is lowered again and this is cleared, so a cancelled first order does not use
   * up the first-order perks.
   */
  countsTowardFirstOrder: boolean;
  /** HST registration number printed on the receipt, as configured when the order was placed. */
  hstNumber: string | null;
  cancelReason: string | null;
  completedAt: TimestampLike | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

// ---------- store orders ----------

export type StoreOrderStatus =
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'picked_up'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export type StoreRejectReason =
  | 'out_of_stock'
  | 'cannot_meet_time'
  | 'store_closed'
  | 'pricing_error'
  | 'cannot_deliver_to_site'
  | 'no_response'
  | 'other';

/** Why a store ships less than was ordered (§2.1.1). */
export type ShortReason = 'out_of_stock' | 'damaged' | 'discontinued' | 'other';

/** Where the driver is with this store order, as the supplier board shows it (§2.3). */
export type DriverPhase =
  'assigned' | 'to_store' | 'at_store' | 'loaded' | 'to_site' | 'at_site' | 'delivered' | 'problem';

/** A line as it was sold. Name, price, weight and size are copies, so catalogue edits never rewrite it. */
export interface StoreOrderLine {
  /** `L1`, `L2`, … */
  lineId: string;
  /** `custom` is a special-order line from a quote (D16). */
  kind: 'catalog' | 'custom';
  productId: string | null;
  sku: string | null;
  name: string;
  brand: string | null;
  unit: SellUnit;
  size: string | null;
  categoryId: CategoryId | null;
  imageKey: string | null;
  imageUrl: string | null;
  unitPriceCents: number;
  /** Ordered. */
  quantity: number;
  /** Equal to `quantity` until the store ships short; only ever lowered. */
  fulfilledQty: number;
  shortReason: ShortReason | null;
  /** `unitPriceCents × quantity`, as placed. */
  lineCents: number;
  /** This line's share of the order discount, fixed at placement for exact settlements and refunds. */
  discountCents: number;
  weightKg: number;
  dimsCm: DimsCm;
  note: string | null;
}

export interface StoreOrderHistoryEntry {
  status: StoreOrderStatus;
  at: TimestampLike;
  actorId: string | null;
  actorName: string | null;
  actorRole: ActorRole;
  note: string | null;
}

/** `storeOrders/{orderId}-{letter}`: what one supplier works on. A pickup reservation is one of these. */
export interface StoreOrder {
  id: string;
  /** `IS-10042-A`. */
  number: string;
  letter: string;
  orderId: string;
  orderNumber: string;
  source: Order['source'];
  storeId: string;
  storeName: string;
  storeAddressLine: string;
  storeLocation: LatLng;
  storePhone: string;
  customerId: string;
  customerName: string;
  companyName: string | null;
  customerPhone: string;
  fulfilment: Fulfilment;
  jobsite: JobsiteSnapshot | null;
  receiving: Receiving | null;
  siteContact: Contact | null;
  instructions: string | null;
  window: DeliveryWindow | null;
  timing: {
    /** The store must accept or reject by then. */
    respondBy: TimestampLike;
    readyBy: TimestampLike;
    /** Toronto date of `readyBy`, for "today" boards. */
    readyByDate: string;
    targetPickupAt: TimestampLike | null;
    deliverBy: TimestampLike | null;
  };
  lines: StoreOrderLine[];
  lineCount: number;
  itemCount: number;
  itemsSummary: string;
  load: LoadSummary;
  vehicleClass: VehicleClass | null;
  roadKm: number | null;
  unload: { offered: boolean; required: boolean; selected: boolean; feeCents: number };
  /** The delivery fee before any waiver. */
  deliveryFeeListCents: number;
  feeWaiver: 'first_order' | 'free_threshold' | 'replacement' | null;
  placed: Amounts;
  /** After shortages and cancellations. Never above `placed`. */
  current: Amounts;
  /**
   * Σ store price × fulfilled quantity: what the store is paid on. Equals `current.itemsCents`, except
   * for a replacement, where the customer pays 0 and this is priced from the catalogue (§3.6).
   */
  storeValueCents: number;
  status: StoreOrderStatus;
  statusAt: Partial<Record<StoreOrderStatus, TimestampLike>>;
  /** +1 on every status change or adjustment; supplier actions send the version they saw. */
  version: number;
  /** At most 40. */
  history: StoreOrderHistoryEntry[];
  deliveryId: string | null;
  /** Projection of the delivery, so suppliers see who is coming without reading deliveries. */
  driver: {
    firstName: string;
    vehicleLabel: string;
    plate: string;
    phase: DriverPhase;
    arrivedAt: TimestampLike | null;
    etaToStoreAt: TimestampLike | null;
  } | null;
  /**
   * `updatedAt` of the delivery that was projected last. Kept when `driver` becomes null, so a late
   * event cannot bring back a driver who released the job.
   */
  driverSyncedAt: TimestampLike | null;
  /** The PIN and its attempts live in `private/meta`. */
  pickup: {
    readyAt: TimestampLike | null;
    holdUntil: TimestampLike | null;
    collectedAt: TimestampLike | null;
    collectedBy: 'customer' | 'driver' | null;
  };
  rejectReason: StoreRejectReason | null;
  cancelReason: string | null;
  cancelledBy: 'customer' | 'store' | 'staff' | 'system' | null;
  reminderSentAt: TimestampLike | null;
  /** Not accepted by `respondBy`; staff are alerted. */
  acceptOverdue: boolean;
  issueCount: number;
  rated: boolean;
  completedAt: TimestampLike | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** `storeOrders/{id}/private/meta`: staff only. The store that checks the PIN never sees it. */
export interface StoreOrderPrivateMeta {
  /** 4 digits. For a delivery it is null until a driver claims the job or is assigned. */
  pickupCode: string | null;
  /** `'customer'` or the driver's uid: a released driver's PIN must stop working. */
  pickupCodeIssuedTo: string | null;
  codeAttempts: number;
  /** The commission rate fixed when the order was placed. */
  commissionBps: number;
  /** The new-order SMS is sent once. */
  alertSmsSentAt: TimestampLike | null;
}

// ---------- the store-order machine (§2.1) ----------

export const STORE_ORDER_STATUSES: readonly StoreOrderStatus[] = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'picked_up',
  'failed',
  'rejected',
  'cancelled',
];

/**
 * Nothing moves a store order out of these. `failed` is not one of them: a failed delivery always
 * needs a staff resolution. An order is settled, and its card is charged, once every store order is
 * final (§2.2, §3.8).
 */
export const FINAL_STORE_ORDER_STATUSES: readonly StoreOrderStatus[] = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

/** A lane of the supplier's order board (§8). A failed delivery stays in "Out for delivery". */
export type StoreOrderColumn = 'new' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'done';

export interface StoreOrderStatusMeta {
  /** The supplier's and staff's word for the status: "New", "Out for delivery", "Delivery failed". */
  label: string;
  /**
   * The customer's wording. Two entries are templates: `new` holds `{store}` ("Waiting for {store} to
   * confirm") and `ready` holds the delivery wording, because a pickup order reads "Ready for pickup"
   * instead. `storeOrderCustomerLabel` gives the final text.
   */
  customerLabel: string;
  tone: StatusTone;
  column: StoreOrderColumn;
}

/**
 * The words and colours of §2.1 "Labels". `column` follows the supplier board of §8: a failed delivery
 * stays in "Out for delivery" until staff resolve it, and everything final lands in "Done".
 */
export const STORE_ORDER_META: Record<StoreOrderStatus, StoreOrderStatusMeta> = {
  new: { label: 'New', customerLabel: 'Waiting for {store} to confirm', tone: 'warning', column: 'new' },
  accepted: { label: 'Accepted', customerLabel: 'Confirmed', tone: 'info', column: 'accepted' },
  preparing: { label: 'Preparing', customerLabel: 'Being prepared', tone: 'info', column: 'preparing' },
  ready: { label: 'Ready', customerLabel: 'Packed — finding a driver', tone: 'brand', column: 'ready' },
  out_for_delivery: {
    label: 'Out for delivery',
    customerLabel: 'On the way',
    tone: 'brand',
    column: 'out_for_delivery',
  },
  delivered: { label: 'Delivered', customerLabel: 'Delivered', tone: 'success', column: 'done' },
  picked_up: { label: 'Picked up', customerLabel: 'Picked up', tone: 'success', column: 'done' },
  failed: {
    label: 'Delivery failed',
    customerLabel: "Delivery issue — we're on it",
    tone: 'danger',
    column: 'out_for_delivery',
  },
  rejected: { label: 'Rejected', customerLabel: 'Not available', tone: 'danger', column: 'done' },
  cancelled: { label: 'Cancelled', customerLabel: 'Cancelled', tone: 'neutral', column: 'done' },
};

/** What a customer reads on a pickup order that is packed: there is no driver to find (§2.1). */
const READY_FOR_PICKUP_LABEL = 'Ready for pickup';

/** One row of the §2.1 table. A row with `fulfilment` applies to delivery or to pickup orders only. */
export interface StoreOrderTransition extends TransitionRule<StoreOrderStatus> {
  fulfilment?: Fulfilment;
}

/**
 * The §2.1 table, one row per row of the spec and in the same order. Each move happens inside its entry
 * point's transaction together with its effects on stock, the delivery and the job offer (D7).
 */
export const STORE_ORDER_TRANSITIONS: readonly StoreOrderTransition[] = [
  { from: ['new'], to: 'accepted', actors: ['supplier', 'staff'], entryPoints: ['acceptStoreOrder'] },
  // A reason is required. Nothing is charged, the stock is released, the delivery is cancelled.
  { from: ['new'], to: 'rejected', actors: ['supplier', 'staff'], entryPoints: ['rejectStoreOrder'] },
  // No answer 20 minutes after `respondBy`: rejected for the store, reason `no_response`.
  { from: ['new'], to: 'rejected', actors: ['system'], entryPoints: ['escalateStoreOrders'] },
  // A customer can back out until the store starts preparing.
  { from: ['new', 'accepted'], to: 'cancelled', actors: ['customer'], entryPoints: ['cancelOrder'] },
  // The store backs out after accepting, with a reason. From `new` the same action is a reject.
  {
    from: ['accepted', 'preparing', 'ready'],
    to: 'cancelled',
    actors: ['supplier'],
    entryPoints: ['rejectStoreOrder'],
  },
  // Staff can cancel for as long as the goods are still at the store.
  {
    from: ['new', 'accepted', 'preparing', 'ready'],
    to: 'cancelled',
    actors: ['staff'],
    entryPoints: ['rejectStoreOrder'],
  },
  {
    from: ['accepted'],
    to: 'preparing',
    actors: ['supplier', 'staff'],
    entryPoints: ['updateStoreOrderStatus'],
  },
  {
    from: ['accepted', 'preparing'],
    to: 'ready',
    actors: ['supplier', 'staff'],
    entryPoints: ['updateStoreOrderStatus'],
  },
  // "Not ready after all": only before the hand-over.
  {
    from: ['ready'],
    to: 'preparing',
    actors: ['supplier', 'staff'],
    entryPoints: ['updateStoreOrderStatus'],
  },
  // The store types the driver's PIN: the load leaves with the driver.
  {
    from: ['ready'],
    to: 'out_for_delivery',
    actors: ['supplier', 'staff'],
    entryPoints: ['completePickup'],
    fulfilment: 'delivery',
  },
  // The store types the customer's PIN: the customer leaves with the goods.
  {
    from: ['ready'],
    to: 'picked_up',
    actors: ['supplier', 'staff'],
    entryPoints: ['completePickup'],
    fulfilment: 'pickup',
  },
  // Not collected by `holdUntil`: the stock goes back on the shelf and nothing is charged.
  {
    from: ['ready'],
    to: 'cancelled',
    actors: ['system'],
    entryPoints: ['expirePickupHolds'],
    fulfilment: 'pickup',
  },
  // The last four rows follow the delivery, which moves in the same transaction. They need no
  // `fulfilment`: only a delivery order can be out for delivery or failed.
  {
    from: ['out_for_delivery'],
    to: 'delivered',
    actors: ['driver', 'staff'],
    entryPoints: ['completeDelivery', 'updateDeliveryStatus'],
  },
  {
    from: ['out_for_delivery'],
    to: 'failed',
    actors: ['driver', 'staff'],
    entryPoints: ['updateDeliveryStatus'],
  },
  // Re-attempt: the goods are still on the truck.
  { from: ['failed'], to: 'out_for_delivery', actors: ['staff'], entryPoints: ['resolveFailedDelivery'] },
  // Return to store: the goods go back into stock and the items are never charged.
  { from: ['failed'], to: 'cancelled', actors: ['staff'], entryPoints: ['resolveFailedDelivery'] },
];

/** What the store-order machine needs to know besides the status: some moves exist for one fulfilment only. */
export interface StoreOrderTransitionContext {
  fulfilment: Fulfilment;
}

// ---------- order status (§2.2) ----------

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
  'cancelled',
];

/** Orders still moving: the "Active" segment and the active order cards on Home. */
export const ORDER_OPEN_STATUSES: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
];

/**
 * A short word and a badge colour per order status, for badges and status filters. The line a customer
 * reads on an order card is `orderHeadline`, which says more. The colours are those of the store-order
 * status each order status stands for (§2.2), so an order and its store orders never clash on a screen.
 */
export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  placed: { label: 'Placed', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'info' },
  ready: { label: 'Ready', tone: 'brand' },
  on_the_way: { label: 'On the way', tone: 'brand' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * The §2.2 table: each store-order status that still counts, its rank, and the order status it stands
 * for. An order takes the status of its slowest store order. `rejected` and `cancelled` are left out
 * on purpose: they are ignored. A failed delivery ranks with `ready`: the goods are packed and the
 * order waits for staff to send them out again or back to the store.
 */
export const ORDER_STATUS_BY_STORE_ORDER: Partial<
  Record<StoreOrderStatus, { rank: number; orderStatus: OrderStatus }>
> = {
  new: { rank: 0, orderStatus: 'placed' },
  accepted: { rank: 1, orderStatus: 'confirmed' },
  preparing: { rank: 2, orderStatus: 'preparing' },
  ready: { rank: 3, orderStatus: 'ready' },
  failed: { rank: 3, orderStatus: 'ready' },
  out_for_delivery: { rank: 4, orderStatus: 'on_the_way' },
  delivered: { rank: 5, orderStatus: 'completed' },
  picked_up: { rank: 5, orderStatus: 'completed' },
};

/** The statuses an actor may move a store order to from `from` (§2.1). */
export function allowedStoreOrderTransitions(
  from: StoreOrderStatus,
  actor: MachineActor,
  ctx: StoreOrderTransitionContext,
): StoreOrderStatus[] {
  const rules = STORE_ORDER_TRANSITIONS.filter(
    (rule) => rule.fulfilment === undefined || rule.fulfilment === ctx.fulfilment,
  );
  return transitionTargets(rules, from, actor);
}

/**
 * Whether an actor may move a store order from `from` to `to` (§2.1). It answers from the table only;
 * the entry point still checks what the table cannot know: the version, the PIN, that the delivery is
 * accepted by its driver, that a reason was given.
 */
export function canStoreOrderTransition(
  from: StoreOrderStatus,
  to: StoreOrderStatus,
  actor: MachineActor,
  ctx: StoreOrderTransitionContext,
): boolean {
  return allowedStoreOrderTransitions(from, actor, ctx).includes(to);
}

export function isFinalStoreOrderStatus(status: StoreOrderStatus): boolean {
  return FINAL_STORE_ORDER_STATUSES.includes(status);
}

/** Rejected or cancelled: nothing is supplied and nothing is charged for this store order. */
function isVoidStoreOrderStatus(status: StoreOrderStatus): boolean {
  return status === 'rejected' || status === 'cancelled';
}

/**
 * What the customer reads on a store order's card (§2.1 "Labels"): "Waiting for Kestrel Lumber Yard to
 * confirm", "Confirmed", "Being prepared", "Packed — finding a driver" or, for pickup, "Ready for
 * pickup", "On the way", "Delivered", "Picked up", "Delivery issue — we're on it", "Not available",
 * "Cancelled".
 */
export function storeOrderCustomerLabel(
  storeOrder: Pick<StoreOrder, 'status' | 'fulfilment' | 'storeName'>,
): string {
  if (storeOrder.status === 'ready' && storeOrder.fulfilment === 'pickup') return READY_FOR_PICKUP_LABEL;
  const label = STORE_ORDER_META[storeOrder.status]?.customerLabel ?? storeOrder.status;
  // A function, not a string, as the replacement: a store name may contain "$&" or "$1".
  return label.replace('{store}', () => storeOrder.storeName);
}

/**
 * The order's status from its store orders (§2.2). Rejected and cancelled ones are ignored; when
 * nothing is left the order is `cancelled`; otherwise it takes the status of the slowest one that is
 * left. Never stored by hand: `syncOrderAggregate` is the only writer.
 */
export function orderStatusFromStoreOrders(statuses: readonly StoreOrderStatus[]): OrderStatus {
  let slowest: { rank: number; orderStatus: OrderStatus } | null = null;
  for (const status of statuses) {
    const row = ORDER_STATUS_BY_STORE_ORDER[status];
    if (row !== undefined && (slowest === null || row.rank < slowest.rank)) slowest = row;
  }
  return slowest === null ? 'cancelled' : slowest.orderStatus;
}

/** True once every store order is final. That is the moment the card is charged (§3.8). */
export function isOrderSettled(statuses: readonly StoreOrderStatus[]): boolean {
  return statuses.every(isFinalStoreOrderStatus);
}

/** `needsAttention`: a delivery failed, or a store did not accept in time (§2.2). */
export function orderNeedsAttention(
  storeOrders: readonly Pick<StoreOrder, 'status' | 'acceptOverdue'>[],
): boolean {
  return storeOrders.some((storeOrder) => storeOrder.status === 'failed' || storeOrder.acceptOverdue);
}

export function isOrderOpen(status: OrderStatus): boolean {
  return ORDER_OPEN_STATUSES.includes(status);
}

/** "1 store", "2 stores". */
function countStores(count: number): string {
  return `${count} store${count === 1 ? '' : 's'}`;
}

/**
 * The one line an order card leads with (§2.2); the first match wins: cancelled "Cancelled" →
 * completed "Completed" (+ " · 1 store cancelled" when any store order was void) → any failed
 * "Delivery issue — we're on it" → any out for delivery "On the way · {d} of {n} delivered" → any
 * pickup store order ready "Ready for pickup" → any new "Waiting for {k} store{s} to confirm" → all
 * remaining ready "Ready — finding a driver" → otherwise "Preparing your order".
 */
export function orderHeadline(order: Pick<Order, 'status' | 'storeOrders'>): string {
  const storeOrders = order.storeOrders;
  const count = (status: StoreOrderStatus) =>
    storeOrders.filter((storeOrder) => storeOrder.status === status).length;
  const voided = storeOrders.filter((storeOrder) => isVoidStoreOrderStatus(storeOrder.status)).length;

  if (order.status === 'cancelled') return 'Cancelled';
  if (order.status === 'completed') {
    return voided === 0 ? 'Completed' : `Completed · ${countStores(voided)} cancelled`;
  }
  if (count('failed') > 0) return STORE_ORDER_META.failed.customerLabel;
  if (count('out_for_delivery') > 0) {
    // {n} counts the store orders the customer is still getting: a rejected or cancelled one will
    // never be delivered, so it would keep "2 of 3" from ever reaching 3.
    return `On the way · ${count('delivered')} of ${storeOrders.length - voided} delivered`;
  }
  if (storeOrders.some((storeOrder) => storeOrder.fulfilment === 'pickup' && storeOrder.status === 'ready')) {
    return READY_FOR_PICKUP_LABEL;
  }
  const waiting = count('new');
  if (waiting > 0) return `Waiting for ${countStores(waiting)} to confirm`;
  // "Remaining" are the store orders still in progress: one that is already delivered does not make
  // the rest any less ready. This is exactly when the order's own status is `ready`.
  const remaining = storeOrders.filter((storeOrder) => !isFinalStoreOrderStatus(storeOrder.status));
  if (remaining.length > 0 && remaining.every((storeOrder) => storeOrder.status === 'ready')) {
    return 'Ready — finding a driver';
  }
  return 'Preparing your order';
}
