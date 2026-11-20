import {
  availableQty,
  localDateOf,
  priceCheckout,
  type CartLine,
  type CheckoutInput,
  type PricedCheckout,
  type PricedStore,
  type PricingLine,
  type PricingStoreInput,
  type Product,
  type Store,
  type WithId,
} from '@instasupply/shared';
import { useMemo } from 'react';

import { useProductsByIds } from '@/features/catalog/hooks';
import { useSession } from '@/features/session/SessionProvider';
import { useSite } from '@/features/site/SiteProvider';
import { storeView, useStores, type StoreView } from '@/features/stores/hooks';
import { useNow } from '@/hooks/useNow';

import { useCart } from './CartProvider';

/** Something a line or a store needs the customer to fix or know before checkout. */
export type CartWarning =
  | { kind: 'missing_product'; productId: string; storeId: string; message: string }
  | { kind: 'not_listed'; productId: string; storeId: string; message: string }
  | { kind: 'out_of_stock'; productId: string; storeId: string; message: string }
  | { kind: 'only_left'; productId: string; storeId: string; available: number; message: string }
  | { kind: 'missing_store'; storeId: string; message: string }
  | {
      kind: 'pricing';
      storeId: string | null;
      code: PricedCheckout['blockers'][number]['code'];
      message: string;
    };

export interface CartGroupLine {
  line: CartLine;
  /** Null when the product no longer exists (it is left out of the pricing). */
  product: Product | null;
  /** What can still be sold now. */
  available: number;
}

/** One store's section of the cart: header, lines, priced amounts and warnings. */
export interface CartGroup {
  storeId: string;
  store: WithId<Store> | null;
  /** Distance and promise from the current site, with the cart's vehicle class for this store. */
  view: StoreView | null;
  lines: CartGroupLine[];
  /** Null when the store or every product of it is missing. */
  priced: PricedStore | null;
  warnings: CartWarning[];
}

export interface CartPricing {
  groups: CartGroup[];
  /** Null while products or stores load, or when nothing in the cart can be priced. */
  pricing: PricedCheckout | null;
  /** Every warning, cart-level ones (storeId null) included. */
  warnings: CartWarning[];
  /** The input `pricing` came from; checkout sends the same choices to `placeOrder`. */
  input: CheckoutInput | null;
  /** Nothing blocks the order: priced, `canPlace`, no stock problems. */
  canCheckout: boolean;
  loading: boolean;
  error: unknown;
  retry: () => void;
}

function pricingLine(product: Product, quantity: number): PricingLine {
  return {
    lineId: product.id,
    kind: 'catalog',
    productId: product.id,
    name: product.name,
    unit: product.unit,
    size: product.size,
    unitPriceCents: product.priceCents,
    quantity,
    weightKg: product.weightKg,
    dimsCm: product.dimsCm,
  };
}

/**
 * The cart joined with live products, stores, the current site and the profile, priced locally
 * with `priceCheckout` exactly as the server will (MARKETPLACE §7.2). If products or stores fail
 * to load, `error` is set: show it with `retry`, never the lines as missing or a zero total.
 */
export function useCartPricing(): CartPricing {
  const cart = useCart();
  const { profile } = useSession();
  const { site } = useSite();
  const now = useNow(60_000);
  const ids = useMemo(() => cart.lines.map((line) => line.productId), [cart.lines]);
  const products = useProductsByIds(ids);
  const stores = useStores();

  return useMemo<CartPricing>(() => {
    const loading = !cart.ready || products.loading || stores.loading;
    const error = products.error ?? stores.error;
    const retry = () => {
      products.retry();
      stores.retry();
    };
    const productById = new Map(products.data.map((product) => [product.id, product]));
    const storeById = new Map(stores.data.map((store) => [store.id, store]));
    const warnings: CartWarning[] = [];
    const inputs: PricingStoreInput[] = [];
    const draft = new Map<string, CartGroupLine[]>();

    for (const line of cart.lines) {
      const product = productById.get(line.productId) ?? null;
      const available = product ? availableQty(product) : 0;
      const lines = draft.get(line.storeId) ?? [];
      lines.push({ line, product, available });
      draft.set(line.storeId, lines);
      if (loading || error) continue;
      if (!product) {
        warnings.push({
          kind: 'missing_product',
          productId: line.productId,
          storeId: line.storeId,
          message: 'No longer sold',
        });
      } else if (!product.listed) {
        warnings.push({
          kind: 'not_listed',
          productId: product.id,
          storeId: line.storeId,
          message: 'Not available right now',
        });
      } else if (available <= 0) {
        warnings.push({
          kind: 'out_of_stock',
          productId: product.id,
          storeId: line.storeId,
          message: 'Out of stock',
        });
      } else if (available < line.quantity) {
        warnings.push({
          kind: 'only_left',
          productId: product.id,
          storeId: line.storeId,
          available,
          message: `Only ${available} left`,
        });
      }
    }

    for (const [storeId, lines] of draft) {
      const store = storeById.get(storeId);
      if (!store) {
        if (!loading && !error)
          warnings.push({
            kind: 'missing_store',
            storeId,
            message: 'This store is no longer on InstaSupply',
          });
        continue;
      }
      const priceable = lines.filter((entry) => entry.product);
      if (priceable.length === 0) continue;
      inputs.push({
        storeId,
        store,
        lines: priceable.map((entry) => pricingLine(entry.product as Product, entry.line.quantity)),
      });
    }

    let input: CheckoutInput | null = null;
    let pricing: PricedCheckout | null = null;
    if (!loading && !error && inputs.length > 0) {
      input = {
        fulfilment: cart.fulfilment,
        stores: inputs,
        dropoff:
          cart.fulfilment === 'delivery' && site
            ? { location: site.location, receiving: site.receiving, maxVehicleClass: site.maxVehicleClass }
            : null,
        unloadHelpStoreIds: cart.unloadHelpStoreIds,
        promoCode: cart.promoCode,
        customer: {
          // A guest is priced as a first order; the server decides at checkout.
          isFirstOrder: profile ? (profile.stats?.nonCancelledOrders ?? 0) === 0 : true,
          promoUses: profile?.promoUses ?? {},
        },
        source: 'cart',
        today: localDateOf(now),
      };
      pricing = priceCheckout(input);
      for (const blocker of pricing.blockers) {
        warnings.push({
          kind: 'pricing',
          storeId: blocker.storeId,
          code: blocker.code,
          message: blocker.message,
        });
      }
    }

    const groups: CartGroup[] = [...draft].map(([storeId, lines]) => {
      const store = storeById.get(storeId) ?? null;
      const priced = pricing?.stores.find((entry) => entry.storeId === storeId) ?? null;
      return {
        storeId,
        store,
        view: store ? storeView(store, site?.location ?? null, now, priced?.vehicleClass ?? 'pickup') : null,
        lines,
        priced,
        warnings: warnings.filter((warning) => warning.storeId === storeId),
      };
    });

    const stockProblem = warnings.some((warning) => warning.kind !== 'pricing');
    return {
      groups,
      pricing,
      warnings,
      input,
      canCheckout: !loading && !error && pricing != null && pricing.canPlace && !stockProblem,
      loading,
      error,
      retry,
    };
  }, [cart, profile, site, now, products, stores]);
}
