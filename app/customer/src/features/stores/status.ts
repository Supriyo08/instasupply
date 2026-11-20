import { MAX_LINE_QUANTITY, shortStoreName, type Product, type Store } from '@instasupply/shared';

/** True when a new order can go to the store: it is live and has not paused new orders (§2.8). */
export function canOrderFrom(store: Pick<Store, 'status' | 'acceptingOrders'> | null | undefined): boolean {
  return !!store && store.status === 'live' && store.acceptingOrders;
}

/** Why a store's listings are browse-only, in a sentence; null when the store takes orders. */
export function browseOnlyReason(store: Pick<Store, 'name' | 'status' | 'acceptingOrders'>): string | null {
  const name = shortStoreName(store.name);
  if (store.status === 'onboarding')
    return `${name} is joining InstaSupply. Browse now; ordering opens soon.`;
  if (store.status === 'coming_soon') return `${name} is coming soon. Browse now; ordering opens soon.`;
  if (store.status === 'closed') return `${name} has closed on InstaSupply.`;
  if (!store.acceptingOrders) return `${name} has paused new orders for now. Check back soon.`;
  return null;
}

/** The most of one listing a single order can take: stock, the store's per-order cap and the cart cap. */
export function maxOrderQuantity(product: Pick<Product, 'maxPerOrder'>, available: number): number {
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, available, product.maxPerOrder ?? MAX_LINE_QUANTITY));
}

/** "Kestrel · 13.0 km" for cards; just the name without a site. */
export function storeLine(storeName: string, distance: string | null): string {
  const name = shortStoreName(storeName);
  return distance ? `${name} · ${distance}` : name;
}
