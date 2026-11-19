/**
 * Pure helpers for shop orders: list filters, payment labels, item summaries, search and the
 * staff cancel rule. No React and no illustrations, so any screen can import them cheaply.
 */
import {
  ORDER_OPEN_STATUSES,
  canTransition,
  isTerminalStatus,
  type CardBrand,
  type Delivery,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@instasupply/shared';

import type { Tone } from '@/components/ui/Badge';

// ---------- list tabs (?status=…) ----------

export type OrderTab = 'open' | 'attention' | 'delivered' | 'cancelled' | 'all';

export interface OrderListFilter {
  tab: OrderTab;
  /** Narrows the open list to one open status (deep links such as `?status=placed`). */
  status: OrderStatus | null;
}

/** Reads `?status=`: a tab name, or a raw order status (open ones filter the open list). */
export function parseStatusParam(value: string | null): OrderListFilter {
  switch (value) {
    case 'attention':
    case 'failed':
      return { tab: 'attention', status: null };
    case 'delivered':
    case 'cancelled':
    case 'all':
      return { tab: value, status: null };
    default:
      return { tab: 'open', status: ORDER_OPEN_STATUSES.find((status) => status === value) ?? null };
  }
}

/** Link to the orders list: a tab, or one order status (as read by `parseStatusParam`). */
export function ordersHref(view: OrderTab | OrderStatus = 'open'): string {
  return view === 'open' ? '/orders' : `/orders?status=${view}`;
}

// ---------- payment ----------

const CARD_BRANDS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  rupay: 'RuPay',
  amex: 'Amex',
  card: 'Card',
};

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  cod_pending: { label: 'To collect', tone: 'neutral' },
  collected: { label: 'Collected', tone: 'success' },
  paid: { label: 'Paid', tone: 'success' },
  refund_pending: { label: 'Refund pending', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
};

type PaymentFields = Pick<Order, 'status' | 'paymentMethod' | 'paymentStatus' | 'card' | 'total'>;

export function paymentStatusMeta(order: Pick<Order, 'status' | 'paymentStatus'>): {
  label: string;
  tone: Tone;
} {
  // Cash is never collected for a cancelled order, whatever the payment record still says.
  if (order.status === 'cancelled' && order.paymentStatus === 'cod_pending') {
    return { label: 'Not collected', tone: 'neutral' };
  }
  return PAYMENT_STATUS[order.paymentStatus];
}

/** "COD" or "Card •••• 4242". */
export function paymentMethodLabel(order: Pick<Order, 'paymentMethod' | 'card'>): string {
  if (order.paymentMethod === 'cod') return 'COD';
  return order.card ? `Card •••• ${order.card.last4}` : 'Card';
}

/** "Visa •••• 4242". */
export function cardLabel(card: NonNullable<Order['card']>): string {
  return `${CARD_BRANDS[card.brand] ?? 'Card'} •••• ${card.last4}`;
}

/** Cash the driver still has to collect on delivery, or null. */
export function cashToCollect(order: PaymentFields): number | null {
  const due =
    order.paymentMethod === 'cod' && order.paymentStatus === 'cod_pending' && order.status !== 'cancelled';
  return due ? order.total : null;
}

// ---------- items ----------

/** "Strawberry, Banana +3 more". */
export function itemNames(order: Pick<Order, 'items'>, count: number): string {
  const names = order.items.slice(0, count).map((item) => item.name);
  const rest = order.items.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ');
}

// ---------- search ----------

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** Order number, customer or recipient name, phone (any formatting) or city. */
export function matchesOrderSearch(order: Order, term: string): boolean {
  const text = term.trim().toLowerCase();
  if (!text) return true;
  const haystack = [
    order.number,
    order.customerName,
    order.address.name,
    order.address.phone,
    order.address.city,
  ]
    .join(' ')
    .toLowerCase();
  if (haystack.includes(text)) return true;
  const digits = digitsOf(text);
  return digits.length >= 4 && digitsOf(order.address.phone).includes(digits);
}

// ---------- actions ----------

/** Staff may cancel an open order until its delivery is finished (delivered, failed or cancelled). */
export function canCancelOrder(
  order: Pick<Order, 'status'>,
  delivery: Pick<Delivery, 'status'> | null,
): boolean {
  return (
    !!delivery &&
    ORDER_OPEN_STATUSES.includes(order.status) &&
    !isTerminalStatus(delivery.status) &&
    canTransition(delivery.status, 'cancelled', 'staff')
  );
}
