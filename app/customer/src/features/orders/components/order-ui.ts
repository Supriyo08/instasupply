/** Presentation helpers shared by the order list, the tracking screen and the notifications inbox. */
import {
  ORDER_PROGRESS,
  type ORDER_STATUS_META,
  type CardBrand,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@instasupply/shared';

import type { IconName } from '@/components/ui';
import { colors, productBackdrops } from '@/theme/tokens';

export type Tone = (typeof ORDER_STATUS_META)[OrderStatus]['tone'];

/** Foreground and soft background for each status tone. */
export const TONES: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.textMuted, bg: colors.background },
  info: { fg: colors.info, bg: colors.infoSoft },
  brand: { fg: colors.primaryDark, bg: colors.primarySoft },
  success: { fg: colors.primaryDark, bg: colors.primaryTint },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
};

/** Line icon for each order status (timeline steps, list cards, status banner). */
export const STATUS_ICONS: Record<OrderStatus, IconName> = {
  placed: 'package',
  confirmed: 'check-circle',
  packed: 'shopping-bag',
  out_for_delivery: 'truck',
  delivered: 'home',
  failed: 'alert-triangle',
  cancelled: 'x-circle',
};

export const orderTitle = (order: Pick<Order, 'number'>) => `Order #${order.number}`;

/**
 * Index in ORDER_PROGRESS of the furthest step the order reached. Failed and cancelled orders
 * report the last progress step that has a timestamp.
 */
export function reachedStepIndex(order: Pick<Order, 'status' | 'statusAt'>): number {
  const index = ORDER_PROGRESS.indexOf(order.status);
  if (index >= 0) return index;
  return ORDER_PROGRESS.reduce(
    (furthest, step, stepIndex) => (order.statusAt?.[step] ? stepIndex : furthest),
    0,
  );
}

const CARD_BRANDS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  rupay: 'RuPay',
  amex: 'Amex',
  card: 'Card',
};

export function paymentMethodLabel(order: Pick<Order, 'paymentMethod' | 'card'>): string {
  if (order.paymentMethod === 'cod') return 'Cash on delivery';
  return order.card ? `${CARD_BRANDS[order.card.brand]} •••• ${order.card.last4}` : 'Card';
}

interface PaymentState {
  label: string;
  note: string;
  tone: Tone;
}

const PAYMENT_STATES: Record<PaymentStatus, PaymentState> = {
  cod_pending: {
    label: 'Pay on delivery',
    note: 'Pay your delivery partner when the order arrives',
    tone: 'warning',
  },
  collected: { label: 'Paid', note: 'Paid on delivery', tone: 'success' },
  paid: { label: 'Paid', note: 'Charged to your card', tone: 'success' },
  refund_pending: { label: 'Refund pending', note: 'Your refund is on its way to your card', tone: 'info' },
  refunded: { label: 'Refunded', note: 'Refunded to your card', tone: 'neutral' },
};

export function paymentStateOf(order: Pick<Order, 'paymentStatus' | 'status'>): PaymentState {
  if (order.status === 'cancelled' && order.paymentStatus === 'cod_pending') {
    return { label: 'Not charged', note: 'Nothing to pay for a cancelled order', tone: 'neutral' };
  }
  return PAYMENT_STATES[order.paymentStatus] ?? PAYMENT_STATES.cod_pending;
}

const BACKDROPS = Object.values(productBackdrops);

/** Pastel circle colour behind an item illustration (order items carry no category). */
export const backdropFor = (index: number): string =>
  BACKDROPS[index % BACKDROPS.length] ?? colors.primaryTint;
