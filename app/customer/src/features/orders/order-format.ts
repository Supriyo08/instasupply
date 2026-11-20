/**
 * Words, colours and amounts the order screens share: promises, store-order timelines, shortages and
 * payment lines. Statuses and headlines themselves come from `@instasupply/shared` (§2.1, §2.2).
 */
import {
  formatClockET,
  formatDayET,
  formatMoney,
  ORDER_STATUS_META,
  STORE_ORDER_META,
  toMillis,
  type Fulfilment,
  type Order,
  type OrderStatus,
  type SellUnit,
  type ShortReason,
  type StatusTone as DomainTone,
  type StoreOrder,
  type StoreOrderLine,
  type StoreOrderStatus,
  type StoreOrderSummary,
  type TimestampLike,
} from '@instasupply/shared';

import type { StatusTone } from '@/theme/tokens';

import { CARD_BRAND_LABEL } from '@/features/account/card/card-format';

/** The kit has no separate "brand" pill: green marks promises and good news alike (§7.1). */
export function pillTone(tone: DomainTone): StatusTone {
  return tone === 'brand' ? 'success' : tone;
}

export const orderTone = (status: OrderStatus): StatusTone => pillTone(ORDER_STATUS_META[status].tone);
export const storeOrderTone = (status: StoreOrderStatus): StatusTone =>
  pillTone(STORE_ORDER_META[status].tone);

/** "1:50 pm" today, "Tomorrow 7:00 am", "Fri, Nov 20 7:00 am". */
export function dayAndClock(value: TimestampLike, now: number): string {
  const day = formatDayET(value, now);
  return day === 'Today' ? formatClockET(value) : `${day} ${formatClockET(value)}`;
}

interface PromiseInput {
  fulfilment: Fulfilment;
  status: StoreOrderStatus;
  deliverBy: TimestampLike | null;
  readyAt: TimestampLike | null;
  holdUntil: TimestampLike | null;
}

export function promiseInputOf(storeOrder: StoreOrderSummary | StoreOrder): PromiseInput {
  if ('timing' in storeOrder) {
    return {
      fulfilment: storeOrder.fulfilment,
      status: storeOrder.status,
      deliverBy: storeOrder.timing.deliverBy,
      readyAt: storeOrder.pickup.readyAt ?? storeOrder.timing.readyBy,
      holdUntil: storeOrder.pickup.holdUntil,
    };
  }
  return {
    fulfilment: storeOrder.fulfilment,
    status: storeOrder.status,
    deliverBy: storeOrder.deliverBy,
    readyAt: storeOrder.readyAt,
    holdUntil: storeOrder.holdUntil,
  };
}

const OPEN: readonly StoreOrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

/**
 * The promise of a store order still in progress: "Delivery by 1:50 pm", "Pickup ready in 25 min",
 * "Ready · held until Fri 5:00 pm". Null once it is finished, failed or void.
 */
export function storeOrderPromise(input: PromiseInput, now: number): string | null {
  if (!OPEN.includes(input.status)) return null;
  if (input.fulfilment === 'delivery') {
    if (input.deliverBy == null) return null;
    const day = formatDayET(input.deliverBy, now);
    const clock = formatClockET(input.deliverBy);
    if (day === 'Today') return `Delivery by ${clock}`;
    return `Delivery ${day === 'Tomorrow' ? 'tomorrow' : day} by ${clock}`;
  }
  if (input.status === 'ready') {
    return input.holdUntil != null
      ? `Pickup ready · held until ${dayAndClock(input.holdUntil, now)}`
      : 'Pickup ready now';
  }
  const readyAt = toMillis(input.readyAt);
  if (readyAt == null) return null;
  const minutes = Math.round((readyAt - now) / 60_000);
  if (minutes <= 0) return 'Pickup ready soon';
  if (minutes < 60) return `Pickup ready in ${minutes} min`;
  return `Pickup ready ${dayAndClock(readyAt, now)}`;
}

/** Cancel these items: only while the store has not started preparing (§2.1). */
export const isCancellable = (status: StoreOrderStatus) => status === 'new' || status === 'accepted';

// ---------- timeline ----------

export interface TimelineStep {
  key: string;
  label: string;
  at: TimestampLike | null;
  state: 'done' | 'current' | 'todo' | 'problem';
}

const DELIVERY_STEPS: readonly [StoreOrderStatus, string][] = [
  ['new', 'Order placed'],
  ['accepted', 'Confirmed by the store'],
  ['preparing', 'Being prepared'],
  ['ready', 'Packed and ready'],
  ['out_for_delivery', 'On the way to your site'],
  ['delivered', 'Delivered'],
];

const PICKUP_STEPS: readonly [StoreOrderStatus, string][] = [
  ['new', 'Order placed'],
  ['accepted', 'Confirmed by the store'],
  ['preparing', 'Being prepared'],
  ['ready', 'Ready for pickup'],
  ['picked_up', 'Picked up'],
];

/** The store order's steps with the time each was reached; a failure or cancellation ends the list. */
export function storeOrderTimeline(storeOrder: StoreOrder): TimelineStep[] {
  const steps = storeOrder.fulfilment === 'pickup' ? PICKUP_STEPS : DELIVERY_STEPS;
  const status = storeOrder.status;
  const atOf = (step: StoreOrderStatus) =>
    step === 'new' ? (storeOrder.statusAt.new ?? storeOrder.createdAt) : (storeOrder.statusAt[step] ?? null);
  const void_ = status === 'rejected' || status === 'cancelled';
  const failed = status === 'failed';
  // How far it got: a failed delivery was on the way; a void one stops after its last stamped step.
  let reached = steps.findIndex(([step]) => step === status);
  if (failed) reached = steps.findIndex(([step]) => step === 'out_for_delivery');
  if (void_) {
    reached = 0;
    steps.forEach(([step], index) => {
      if (storeOrder.statusAt[step] != null) reached = index;
    });
  }
  const final = status === 'delivered' || status === 'picked_up';
  const result: TimelineStep[] = steps.map(([step, label], index) => ({
    key: step,
    label,
    at: index <= reached ? atOf(step) : null,
    state:
      index < reached || (index === reached && (final || void_ || failed))
        ? 'done'
        : index === reached
          ? 'current'
          : 'todo',
  }));
  if (failed || void_) {
    const cut = result.slice(0, reached + 1);
    cut.push({
      key: status,
      label: failed
        ? "Delivery issue — we're on it"
        : status === 'rejected'
          ? 'The store could not fill this order'
          : 'Cancelled',
      at: storeOrder.statusAt[status] ?? storeOrder.updatedAt,
      state: 'problem',
    });
    return cut;
  }
  return result;
}

// ---------- lines ----------

const SHORT_REASON: Record<ShortReason, string> = {
  out_of_stock: 'out of stock',
  damaged: 'damaged at the store',
  discontinued: 'discontinued',
  other: 'not available',
};

/** "20 of 24 — out of stock", or null when the line ships in full. */
export function shortageText(line: Pick<StoreOrderLine, 'quantity' | 'fulfilledQty' | 'shortReason'>) {
  if (line.fulfilledQty >= line.quantity) return null;
  const reason = SHORT_REASON[line.shortReason ?? 'other'];
  return `${line.fulfilledQty} of ${line.quantity} — ${reason}`;
}

const UNIT_PLURAL: Partial<Record<SellUnit, string>> = { box: 'boxes', each: '' };

/** "24 sheets", "1 bundle", "6" for items sold each. */
export function quantityText(quantity: number, unit: SellUnit): string {
  if (unit === 'each') return `${quantity.toLocaleString('en-CA')}`;
  const word = quantity === 1 ? unit : (UNIT_PLURAL[unit] ?? `${unit}s`);
  return `${quantity.toLocaleString('en-CA')} ${word}`;
}

// ---------- payment ----------

/** "Visa ••4242", or null when the order needed no card. */
export function cardText(order: Pick<Order, 'payment'>): string | null {
  const card = order.payment.card;
  return card ? `${CARD_BRAND_LABEL[card.brand]} ••${card.last4}` : null;
}

/** The one-line payment state of an order card: "Card held · $388.25", "Paid · $383.40". */
export function paymentText(order: Pick<Order, 'payment' | 'current'>): string {
  const payment = order.payment;
  switch (payment.status) {
    case 'authorized':
      return `Card held · ${formatMoney(payment.authorizedCents)}`;
    case 'capture_pending':
      return 'Charging your card';
    case 'captured':
      return `Paid · ${formatMoney(payment.capturedCents)}`;
    case 'capture_failed':
      return "Payment problem — we'll contact you";
    case 'partially_refunded':
      return `Paid · ${formatMoney(payment.refundedCents)} refunded`;
    case 'refunded':
      return `Refunded · ${formatMoney(payment.refundedCents)}`;
    case 'voided':
      return 'Card hold released';
    case 'not_required':
      return 'Nothing to pay';
    default:
      return formatMoney(order.current.totalCents);
  }
}

/** What went back to the card: the part of the hold that was never charged. */
export function releasedCents(order: Pick<Order, 'payment'>): number {
  const payment = order.payment;
  if (payment.status === 'voided') return payment.authorizedCents;
  if (payment.status === 'authorized' || payment.status === 'capture_pending') return 0;
  return Math.max(0, payment.authorizedCents - payment.capturedCents);
}

/** "Thu, Nov 19 · 10:42 am" for order cards and receipts. */
export function placedAtText(order: Pick<Order, 'createdAt'>, now: number): string {
  return `${formatDayET(order.createdAt, now)} · ${formatClockET(order.createdAt)}`;
}
