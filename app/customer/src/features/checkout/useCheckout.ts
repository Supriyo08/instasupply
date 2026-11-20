import { useConfig } from '@instasupply/api-client/react';
import {
  asapWindow,
  isFutureExpiry,
  pickupReady,
  priceCheckout,
  scheduledWindows,
  type Jobsite,
  type PickupPromise,
  type PlaceOrderRequest,
  type PricedCheckout,
  type Receiving,
  type SavedCard,
  type Store,
  type WindowOption,
  type WindowStoreInput,
  type WithId,
} from '@instasupply/shared';
import { useMemo } from 'react';

import { useCards } from '@/features/cards/hooks';
import { useCart } from '@/features/cart/CartProvider';
import { useCartPricing, type CartGroup, type CartWarning } from '@/features/cart/useCartPricing';
import { useJobsites } from '@/features/site/hooks';
import { useSite } from '@/features/site/SiteProvider';
import { useNow } from '@/hooks/useNow';

import { usableServerWindows, useCheckoutDraft, windowsKeyOf } from './checkout-draft';

export interface PickupStop {
  storeId: string;
  store: WithId<Store>;
  promise: PickupPromise;
}

export interface Checkout {
  delivery: boolean;
  groups: CartGroup[];
  /** Priced with the chosen jobsite and receiving; null while loading or with nothing to price. */
  pricing: PricedCheckout | null;
  /** Stock problems from the cart plus this pricing's blockers. */
  warnings: CartWarning[];
  jobsites: Jobsite[];
  jobsite: Jobsite | null;
  receiving: Receiving;
  instructions: string;
  cards: SavedCard[];
  card: SavedCard | null;
  cardExpired: boolean;
  /** The ASAP option and every slot of the next 7 days; null when the stores can't be timed yet. */
  windows: WindowOption[] | null;
  /** What the windows depend on (stores, jobsite, receiving): server windows answered for another key are ignored. */
  windowsKey: string;
  selectedWindow: WindowOption | null;
  pickups: PickupStop[];
  paymentsDisabled: boolean;
  loading: boolean;
  error: unknown;
  retry: () => void;
  /** What still keeps the button disabled, in the order to fix it; null when the order can be placed. */
  blocker: string | null;
  /** The `placeOrder` body; null while `blocker` is set. */
  request: (checkoutId: string, expectedTotalCents?: number) => PlaceOrderRequest | null;
}

function windowStoresFor(pricing: PricedCheckout, groups: CartGroup[]): WindowStoreInput[] | null {
  const stores: WindowStoreInput[] = [];
  for (const priced of pricing.stores) {
    const store = groups.find((group) => group.storeId === priced.storeId)?.store;
    if (!store || priced.vehicleClass == null || priced.roadTenths == null) return null;
    stores.push({
      storeId: priced.storeId,
      store,
      vehicleClass: priced.vehicleClass,
      roadTenths: priced.roadTenths,
    });
  }
  return stores;
}

/**
 * Everything `checkout/index` shows and sends: the cart priced for the chosen jobsite and receiving,
 * the delivery windows or pickup times, the card, and the `placeOrder` request. The server prices and
 * times everything again; a different total comes back as `PRICE_CHANGED`.
 */
export function useCheckout(uid: string): Checkout {
  const cart = useCart();
  const cartPricing = useCartPricing();
  const draft = useCheckoutDraft();
  const jobsiteList = useJobsites(uid);
  const cardList = useCards(uid);
  const { site } = useSite();
  const config = useConfig();
  const now = useNow(30_000);
  const delivery = cart.fulfilment === 'delivery';

  const jobsite = useMemo(() => {
    const find = (id: string | null | undefined) =>
      id ? (jobsiteList.data.find((item) => item.id === id) ?? null) : null;
    return find(draft.jobsiteId) ?? find(site?.jobsite?.id) ?? jobsiteList.defaultJobsite;
  }, [draft.jobsiteId, jobsiteList.data, jobsiteList.defaultJobsite, site?.jobsite?.id]);

  const card = useMemo(() => {
    const chosen = draft.cardId ? cardList.data.find((item) => item.id === draft.cardId) : undefined;
    if (chosen) return chosen;
    const usable = cardList.data.filter((item) => isFutureExpiry(item.expMonth, item.expYear, now));
    return usable.find((item) => item.isDefault) ?? usable[0] ?? cardList.defaultCard;
  }, [draft.cardId, cardList.data, cardList.defaultCard, now]);

  const receiving: Receiving = draft.receiving ?? jobsite?.receiving ?? 'attended';
  const instructions = draft.instructions ?? jobsite?.instructions ?? '';

  const pricing = useMemo(() => {
    const input = cartPricing.input;
    if (!input) return null;
    return priceCheckout({
      ...input,
      dropoff:
        delivery && jobsite
          ? { location: jobsite.location, receiving, maxVehicleClass: jobsite.maxVehicleClass }
          : null,
    });
  }, [cartPricing.input, delivery, jobsite, receiving]);

  const warnings = useMemo(() => {
    const stock = cartPricing.warnings.filter((warning) => warning.kind !== 'pricing');
    const blockers: CartWarning[] = (pricing?.blockers ?? []).map((blocker) => ({
      kind: 'pricing',
      storeId: blocker.storeId,
      code: blocker.code,
      message: blocker.message,
    }));
    return [...stock, ...blockers];
  }, [cartPricing.warnings, pricing]);

  const storeIds = useMemo(() => cartPricing.groups.map((group) => group.storeId), [cartPricing.groups]);
  const windowsKey = windowsKeyOf(storeIds, jobsite?.id ?? null, receiving);
  const serverWindows = usableServerWindows(draft, windowsKey, now);

  const windows = useMemo(() => {
    if (!delivery || !pricing) return null;
    if (serverWindows) return serverWindows;
    const stores = windowStoresFor(pricing, cartPricing.groups);
    if (!stores || stores.length === 0) return null;
    return [asapWindow(stores, now), ...scheduledWindows(stores, now)];
  }, [delivery, pricing, cartPricing.groups, serverWindows, now]);

  const selectedWindow = useMemo(() => {
    if (!windows) return null;
    if (draft.windowId) return windows.find((option) => option.id === draft.windowId) ?? null;
    return windows.find((option) => option.available) ?? windows[0] ?? null;
  }, [windows, draft.windowId]);

  const pickups = useMemo<PickupStop[]>(() => {
    if (delivery) return [];
    return cartPricing.groups.flatMap((group) =>
      group.store
        ? [{ storeId: group.storeId, store: group.store, promise: pickupReady(group.store, now) }]
        : [],
    );
  }, [delivery, cartPricing.groups, now]);

  const paymentsDisabled = config?.paymentsMode === 'disabled';
  const cardExpired = card ? !isFutureExpiry(card.expMonth, card.expYear, now) : false;

  let blocker: string | null = null;
  if (cartPricing.loading) blocker = 'Loading your cart…';
  else if (cartPricing.error) blocker = "Couldn't load your cart";
  else if (!pricing || cart.lines.length === 0) blocker = 'Your cart is empty';
  else if (paymentsDisabled) blocker = "Card payments aren't available yet";
  else if (warnings.some((warning) => warning.kind !== 'pricing')) blocker = 'Fix the items marked in red';
  else if (delivery && !jobsite) blocker = 'Choose a jobsite for delivery';
  else if (!pricing.canPlace) blocker = pricing.blockers[0]?.message ?? 'This order can’t be placed yet';
  else if (delivery && !selectedWindow?.available)
    blocker = selectedWindow?.reason ?? 'Choose a delivery time';
  else if (!delivery && pickups.some((stop) => !stop.promise.ok))
    blocker = 'A store can’t take a pickup order';
  else if (!card) blocker = 'Add a card to pay';
  else if (cardExpired) blocker = 'Your card has expired: choose another';

  const request = (checkoutId: string, expectedTotalCents?: number): PlaceOrderRequest | null => {
    if (blocker || !pricing || !card) return null;
    const text = instructions.trim();
    return {
      checkoutId,
      items: cart.lines.map((line) => ({ ...line })),
      fulfilment: cart.fulfilment,
      jobsiteId: delivery ? (jobsite?.id ?? null) : null,
      windowId: delivery ? (selectedWindow?.id ?? null) : null,
      receiving: delivery ? receiving : null,
      siteContact: delivery && jobsite ? { name: jobsite.contactName, phone: jobsite.contactPhone } : null,
      instructions: delivery && text ? text : null,
      unloadHelpStoreIds: delivery ? cart.unloadHelpStoreIds : [],
      cardId: card.id,
      promoCode: cart.promoCode,
      expectedTotalCents: expectedTotalCents ?? pricing.totalCents,
    };
  };

  return {
    delivery,
    groups: cartPricing.groups,
    pricing,
    warnings,
    jobsites: jobsiteList.data,
    jobsite,
    receiving,
    instructions,
    cards: cardList.data,
    card,
    cardExpired,
    windows,
    windowsKey,
    selectedWindow,
    pickups,
    paymentsDisabled,
    loading: cartPricing.loading || jobsiteList.loading || cardList.loading,
    error: cartPricing.error ?? jobsiteList.error ?? cardList.error,
    retry: () => {
      cartPricing.retry();
      jobsiteList.retry();
      cardList.retry();
    },
    blocker,
    request,
  };
}
