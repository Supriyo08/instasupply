import {
  availableQty,
  summarizeLoad,
  type CategoryId,
  type LatLng,
  type Product,
  type Store,
  type VehicleClass,
  type WithId,
} from '@instasupply/shared';

import { storeView, type StoreView } from '@/features/stores/hooks';

/**
 * Client-side ranking and grouping of product listings (MARKETPLACE §7.3 search and category rows):
 * the server finds the listings, the app adds distance and promise from the current site, filters,
 * sorts and groups the same item across stores by `familyKey`.
 */

/** One store's listing with what the current site makes of it. */
export interface Listing {
  product: Product;
  /** Null while the store is unknown (stores still loading, or a store the list hides). */
  view: StoreView | null;
  available: number;
}

export type ListingSort = 'best' | 'price' | 'distance' | 'fastest';

export const LISTING_SORTS: readonly { value: ListingSort; label: string }[] = [
  { value: 'best', label: 'Best match' },
  { value: 'price', label: 'Price' },
  { value: 'distance', label: 'Distance' },
  { value: 'fastest', label: 'Fastest' },
];

export interface ListingFilters {
  categoryId: CategoryId | null;
  deliveryToday: boolean;
  pickup: boolean;
  inStock: boolean;
}

export const NO_FILTERS: ListingFilters = {
  categoryId: null,
  deliveryToday: false,
  pickup: false,
  inStock: false,
};

export function activeFilterCount(filters: ListingFilters): number {
  return [filters.categoryId !== null, filters.deliveryToday, filters.pickup, filters.inStock].filter(Boolean)
    .length;
}

/** The smallest vehicle one unit needs; a pickup truck when the size can't be read. */
export function vehicleClassOf(product: Product): VehicleClass {
  try {
    return summarizeLoad([{ ...product, quantity: 1 }]).vehicleClass ?? 'flatbed';
  } catch {
    return 'pickup';
  }
}

/** Joins products to their stores, measured from `site` with the vehicle each product needs. */
export function toListings(
  products: readonly Product[],
  stores: ReadonlyMap<string, WithId<Store>>,
  site: LatLng | null,
  now: number,
): Listing[] {
  return products.map((product) => {
    const store = stores.get(product.storeId);
    return {
      product,
      view: store ? storeView(store, site, now, vehicleClassOf(product)) : null,
      available: availableQty(product),
    };
  });
}

export function filterListings(listings: readonly Listing[], filters: ListingFilters): Listing[] {
  return listings.filter((listing) => {
    if (filters.categoryId && listing.product.categoryId !== filters.categoryId) return false;
    if (filters.inStock && listing.available <= 0) return false;
    if (filters.deliveryToday && listing.view?.availability.deliverBy == null) return false;
    if (filters.pickup && listing.view?.availability.pickupReadyAt == null) return false;
    return true;
  });
}

/** The same item at several stores (`familyKey`), cheapest first. */
export interface FamilyGroup {
  key: string;
  /** Cheapest first. */
  listings: Listing[];
  name: string;
  fromCents: number;
  storeCount: number;
  nearestM: number | null;
  inStock: boolean;
}

export type ResultItem = { kind: 'family'; group: FamilyGroup } | { kind: 'single'; listing: Listing };

const NEVER = Number.POSITIVE_INFINITY;

/** The earliest time the item can be on site or at the counter; Infinity when neither is possible today. */
function fastestAt(listing: Listing): number {
  const availability = listing.view?.availability;
  if (!availability || listing.available <= 0) return NEVER;
  return Math.min(availability.deliverBy ?? NEVER, availability.pickupReadyAt ?? NEVER);
}

const distanceOf = (listing: Listing) => listing.view?.distanceM ?? NEVER;

function byPrice(a: Listing, b: Listing) {
  return a.product.priceCents - b.product.priceCents || distanceOf(a) - distanceOf(b);
}

function familyOf(key: string, listings: Listing[]): FamilyGroup {
  const sorted = [...listings].sort(byPrice);
  const first = sorted[0];
  const distances = sorted.map(distanceOf).filter((meters) => meters !== NEVER);
  return {
    key,
    listings: sorted,
    name: first?.product.name ?? '',
    fromCents: first?.product.priceCents ?? 0,
    storeCount: new Set(sorted.map((listing) => listing.product.storeId)).size,
    nearestM: distances.length ? Math.min(...distances) : null,
    inStock: sorted.some((listing) => listing.available > 0),
  };
}

/**
 * Groups listings that share a `familyKey` into one row, in the order the first of each appears.
 * A family with one listing stays a single listing.
 */
export function groupByFamily(listings: readonly Listing[]): ResultItem[] {
  const families = new Map<string, Listing[]>();
  for (const listing of listings) {
    const key = listing.product.familyKey;
    if (key) families.set(key, [...(families.get(key) ?? []), listing]);
  }
  const seen = new Set<string>();
  const items: ResultItem[] = [];
  for (const listing of listings) {
    const key = listing.product.familyKey;
    const members = key ? families.get(key) : undefined;
    if (key && members && members.length > 1) {
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: 'family', group: familyOf(key, members) });
    } else {
      items.push({ kind: 'single', listing });
    }
  }
  return items;
}

function measure(item: ResultItem, sort: Exclude<ListingSort, 'best'>): number {
  const listings = item.kind === 'family' ? item.group.listings : [item.listing];
  if (sort === 'price') return Math.min(...listings.map((listing) => listing.product.priceCents));
  if (sort === 'distance') return Math.min(...listings.map(distanceOf));
  return Math.min(...listings.map(fastestAt));
}

/**
 * Orders result rows. "Best match" keeps the server's relevance order but moves items nobody can
 * sell right now (out of stock everywhere) to the end; the others sort by their best listing.
 */
export function sortResults(items: readonly ResultItem[], sort: ListingSort): ResultItem[] {
  const indexed = items.map((item, index) => ({ item, index }));
  if (sort === 'best') {
    const inStock = (item: ResultItem) =>
      item.kind === 'family' ? item.group.inStock : item.listing.available > 0;
    return indexed
      .sort((a, b) => Number(inStock(b.item)) - Number(inStock(a.item)) || a.index - b.index)
      .map(({ item }) => item);
  }
  return indexed
    .map(({ item, index }) => ({ item, index, value: measure(item, sort) }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : a.value - b.value))
    .map(({ item }) => item);
}

/** "Delivery today" / "Pickup" / "In stock" chips and the sort, applied in one step. */
export function rankResults(
  listings: readonly Listing[],
  filters: ListingFilters,
  sort: ListingSort,
): ResultItem[] {
  return sortResults(groupByFamily(filterListings(listings, filters)), sort);
}
