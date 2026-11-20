/**
 * Pure helpers for the marketplace order screens (MARKETPLACE §1.3, §2.1, §2.2, §3.8): staff wording
 * for payment states and events, reasons, and small label builders. No React and no illustrations, so
 * any screen (issues, support, stores) can import them cheaply. Status words and colours come from
 * shared (`ORDER_STATUS_META`, `STORE_ORDER_META`): the staff, supplier and customer screens agree.
 */
import type {
  CardBrand,
  Fulfilment,
  Order,
  PaymentEvent,
  PaymentStatus,
  ShortReason,
  StoreOrder,
  StoreRejectReason,
} from '@instasupply/shared';

import type { Tone } from '@/components/ui/Badge';

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  card: 'Card',
};

/** Card payments only (D6): authorized at checkout, captured once every store order is settled. */
export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; tone: Tone }> = {
  authorized: { label: 'Authorized', tone: 'info' },
  capture_pending: { label: 'Capturing', tone: 'info' },
  captured: { label: 'Captured', tone: 'success' },
  capture_failed: { label: 'Capture failed', tone: 'danger' },
  partially_refunded: { label: 'Partly refunded', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  voided: { label: 'Released', tone: 'neutral' },
  not_required: { label: 'No payment', tone: 'neutral' },
};

export const PAYMENT_EVENT_LABELS: Record<PaymentEvent['type'], string> = {
  authorize: 'Authorized',
  void: 'Authorization released',
  capture: 'Captured',
  capture_failed: 'Capture failed',
  release: 'Released',
  refund: 'Refunded',
};

/** The reasons a store (or staff for it) may give when it turns an order down or backs out (§2.1). */
export const REJECT_REASONS: { id: StoreRejectReason; label: string }[] = [
  { id: 'out_of_stock', label: 'Out of stock' },
  { id: 'cannot_meet_time', label: "Can't make the time" },
  { id: 'store_closed', label: 'Store closed' },
  { id: 'pricing_error', label: 'Pricing error' },
  { id: 'cannot_deliver_to_site', label: "Can't deliver to the site" },
  { id: 'other', label: 'Other' },
];

const REJECT_LABELS: Record<StoreRejectReason, string> = {
  out_of_stock: 'Out of stock',
  cannot_meet_time: "Can't make the time",
  store_closed: 'Store closed',
  pricing_error: 'Pricing error',
  cannot_deliver_to_site: "Can't deliver to the site",
  no_response: 'No answer in time',
  other: 'Other',
};

export function rejectReasonLabel(reason: StoreRejectReason | null | undefined): string | null {
  return reason ? REJECT_LABELS[reason] : null;
}

export const SHORT_REASONS: { id: ShortReason; label: string }[] = [
  { id: 'out_of_stock', label: 'Out of stock' },
  { id: 'damaged', label: 'Damaged' },
  { id: 'discontinued', label: 'Discontinued' },
  { id: 'other', label: 'Other' },
];

export const FULFILMENT_LABELS: Record<Fulfilment, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup',
};

export const SOURCE_LABELS: Record<Order['source'], string> = {
  cart: 'Cart',
  quote: 'Quote',
  replacement: 'Replacement',
};

/** "Dana Whitfield · Whitfield Renovations", or the name alone. */
export function customerLine(order: Pick<Order, 'customerName' | 'companyName'>): string {
  return order.companyName ? `${order.customerName} · ${order.companyName}` : order.customerName;
}

/** "Visa •••• 4242", "No payment" for a replacement. */
export function cardLabel(payment: Order['payment']): string {
  if (payment.method === 'none' || !payment.card) return 'No payment';
  return `${CARD_BRAND_LABELS[payment.card.brand] ?? 'Card'} •••• ${payment.card.last4}`;
}

/** Where the store order goes: "Leslieville · M4M" for delivery, "Pickup at the counter" for pickup. */
export function destinationLabel(storeOrder: Pick<StoreOrder, 'fulfilment' | 'jobsite'>): string {
  if (storeOrder.fulfilment === 'pickup') return 'Pickup at the counter';
  return storeOrder.jobsite?.areaLabel ?? 'Jobsite';
}

/** A store order the server still has to move on: not final, so its SLA timers matter. */
export function isStoreOrderOpen(status: StoreOrder['status']): boolean {
  return !['delivered', 'picked_up', 'rejected', 'cancelled'].includes(status);
}

/** Link to an order's detail; store orders open their parent order. */
export function orderHref(orderId: string): string {
  return `/orders/${encodeURIComponent(orderId)}`;
}
