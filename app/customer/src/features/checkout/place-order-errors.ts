import {
  formatMoney,
  type CardDeclineReason,
  type ErrorCode,
  type PricedCheckout,
} from '@instasupply/shared';
import { router } from 'expo-router';

import type { Cart } from '@/features/cart/CartProvider';
import type { CartGroup } from '@/features/cart/useCartPricing';
import { describeError, detailsFor, errorCodeOf, isNetworkError } from '@/lib/api';

import { materialListText, sendAsMaterialList } from './cart-copy';
import { updateCheckoutDraft } from './checkout-draft';

/** What the checkout screen shows after a refused `placeOrder`: the cart is never lost. */
export interface CheckoutProblem {
  title: string;
  message: string;
  /** The section to mark, for the codes that name a store. */
  storeId: string | null;
  /** `PRICE_CHANGED`: the server's total, sent as `expectedTotalCents` when the customer confirms. */
  newTotalCents: number | null;
  /** `PRICE_CHANGED`: the server's whole breakdown, shown in the summary instead of the local one. */
  serverPricing: PricedCheckout | null;
  action: { label: string; run: () => void } | null;
}

const DECLINE_REASONS: Record<CardDeclineReason, string> = {
  card_declined: 'Your bank declined the card.',
  insufficient_funds: 'The card has insufficient funds.',
  expired_card: 'The card has expired.',
  processing_error: "The card couldn't be processed.",
};

const STORE_CODES: readonly ErrorCode[] = [
  'STORE_UNAVAILABLE',
  'STORE_PAUSED',
  'OUT_OF_RANGE',
  'TOO_LARGE',
  'JOBSITE_VEHICLE_LIMIT',
  'DELIVERY_UNAVAILABLE',
  'PICKUP_UNAVAILABLE',
];

function storeIdOf(error: unknown): string | null {
  const code = errorCodeOf(error);
  if (!code || !STORE_CODES.includes(code)) return null;
  const details = detailsFor(error, code as 'STORE_PAUSED');
  return details?.storeId ?? null;
}

/**
 * Maps every MARKETPLACE §5.9 code `placeOrder` can send to an inline fix (docs/CLIENTS.md §4.3
 * checkout row). Side effects that fix the cart (clamping a line) happen here; navigation is offered
 * as the action or done straight away where the spec says "goes to".
 */
export interface ProblemContext {
  /** The cart's store groups, for store names and the material-list conversion. */
  groups: readonly CartGroup[];
  /** `Checkout.windowsKey` when the order was sent: the server windows are kept for that checkout only. */
  windowsKey: string;
  now: number;
}

/** Opens the material-list form with the named store's lines, or the whole cart when none is named. */
function sendListFor(groups: readonly CartGroup[], storeId: string | null) {
  const group = storeId ? groups.find((item) => item.storeId === storeId) : undefined;
  if (group) return sendAsMaterialList(group);
  const items = groups
    .map((item) => materialListText(item.lines))
    .filter(Boolean)
    .join('\n');
  router.push({ pathname: '/quotes/new', params: items ? { items } : {} });
}

export function problemFor(error: unknown, cart: Cart, context: ProblemContext): CheckoutProblem {
  const { groups } = context;
  const storeName = (storeId: string) =>
    groups.find((group) => group.storeId === storeId)?.store?.name ?? 'One store';
  const base: CheckoutProblem = {
    title: "Your order wasn't placed",
    message: describeError(error, 'Something went wrong. Your cart is safe: try again.'),
    storeId: storeIdOf(error),
    newTotalCents: null,
    serverPricing: null,
    action: null,
  };
  if (isNetworkError(error)) {
    return {
      ...base,
      title: "Couldn't reach InstaSupply",
      message: 'Check your connection and try again. You won’t be charged twice.',
    };
  }
  const code = errorCodeOf(error);
  const named = base.storeId ? storeName(base.storeId) : 'One store';

  switch (code) {
    case 'PRICE_CHANGED': {
      const pricing = detailsFor(error, 'PRICE_CHANGED')?.pricing;
      const total = pricing?.totalCents ?? null;
      return {
        ...base,
        title: 'Prices changed',
        message:
          total == null
            ? 'A price or fee changed since you opened checkout. Check the summary and try again.'
            : `Your new total is ${formatMoney(total)}. Review it and confirm to place the order.`,
        newTotalCents: total,
        serverPricing: pricing ?? null,
      };
    }
    case 'WINDOW_UNAVAILABLE': {
      const windows = detailsFor(error, 'WINDOW_UNAVAILABLE')?.windows ?? null;
      updateCheckoutDraft({
        windowId: null,
        serverWindows: windows,
        serverWindowsKey: windows ? context.windowsKey : null,
        serverWindowsAt: windows ? context.now : null,
      });
      return {
        ...base,
        title: 'That delivery time is no longer available',
        message: 'Choose another time for your delivery.',
        action: { label: 'Choose a time', run: () => router.push('/checkout/window') },
      };
    }
    case 'OUT_OF_STOCK': {
      const details = detailsFor(error, 'OUT_OF_STOCK');
      if (details) {
        const line = cart.lines.find((item) => item.productId === details.productId);
        if (line) cart.setQuantity({ id: line.productId, storeId: line.storeId }, details.available);
      }
      return {
        ...base,
        title: 'Not enough in stock',
        message:
          details && details.available > 0
            ? `We changed the quantity to the ${details.available} still available. Check it and place the order again.`
            : 'An item sold out, so we took it out of your cart. Check the order and place it again.',
      };
    }
    case 'STORE_UNAVAILABLE':
    case 'STORE_PAUSED':
      return {
        ...base,
        title: `${named} can't take this order`,
        message: 'Remove its items, or come back when the store is taking orders again.',
        action: base.storeId
          ? { label: 'Remove this store', run: () => cart.removeStore(base.storeId as string) }
          : null,
      };
    case 'OUT_OF_RANGE':
    case 'JOBSITE_VEHICLE_LIMIT':
    case 'DELIVERY_UNAVAILABLE':
      return {
        ...base,
        title: `${named} can't deliver to this jobsite`,
        message: 'Switch this order to pickup, or choose another jobsite.',
        action: { label: 'Switch to pickup', run: () => cart.setFulfilment('pickup') },
      };
    case 'PICKUP_UNAVAILABLE':
      return {
        ...base,
        title: `${named} doesn't offer pickup`,
        message: 'Switch this order to delivery, or remove that store.',
        action: { label: 'Switch to delivery', run: () => cart.setFulfilment('delivery') },
      };
    case 'TOO_LARGE':
      return {
        ...base,
        title: 'Too large for one delivery',
        message: 'Send it as a material list and we’ll quote the delivery.',
        action: { label: 'Send us your list', run: () => sendListFor(groups, base.storeId) },
      };
    case 'EMPTY':
    case 'TOO_MANY_STORES':
      return {
        ...base,
        title: code === 'EMPTY' ? 'Your cart is empty' : 'Too many stores',
        action: { label: 'Back to cart', run: () => router.dismissTo('/cart') },
      };
    case 'NO_DROPOFF':
    case 'OUTSIDE_SERVICE_AREA':
      return {
        ...base,
        title: code === 'NO_DROPOFF' ? 'Choose a jobsite' : 'This jobsite is outside our delivery area',
        message:
          code === 'NO_DROPOFF'
            ? 'Pick where we deliver.'
            : 'We deliver in the Greater Toronto Area. Choose another jobsite or switch to pickup.',
        action: { label: 'Choose a jobsite', run: () => router.push('/checkout/jobsite') },
      };
    case 'PHONE_UNVERIFIED':
      router.push('/verify-phone');
      return {
        ...base,
        title: 'Verify your phone first',
        message: 'Stores and drivers need a number that works. Verify it, then place the order.',
        action: { label: 'Verify phone', run: () => router.push('/verify-phone') },
      };
    case 'CARD_DECLINED': {
      const reason = detailsFor(error, 'CARD_DECLINED')?.reason;
      router.push('/checkout/card');
      return {
        ...base,
        title: 'Card declined',
        message: `${reason ? DECLINE_REASONS[reason] : 'The card was declined.'} Choose another card. Nothing was charged.`,
        action: { label: 'Choose another card', run: () => router.push('/checkout/card') },
      };
    }
    case 'PAYMENTS_DISABLED':
      return {
        ...base,
        title: "Card payments aren't available yet",
        message: 'Your cart is saved. Try again later, or send us your material list for a quote.',
      };
    default:
      return base;
  }
}
