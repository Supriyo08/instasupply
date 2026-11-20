import { queries } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  haversineMeters,
  roadTenths,
  storeAvailability,
  type LatLng,
  type Store,
  type StoreAvailability,
  type VehicleClass,
  type WithId,
} from '@instasupply/shared';
import { useMemo } from 'react';

import { useNow } from '@/hooks/useNow';
import { useSite } from '@/features/site/SiteProvider';

/** In-store browsing filters (`categoryId`, `q`). */
export type StoreProductsParams = NonNullable<Parameters<typeof queries.storeProducts>[1]>;

/** Every store of the GTA market, live. `closed` stores are hidden, as every screen does (§7.3). */
export function useStores() {
  const result = useLiveQuery(queries.stores());
  const data = useMemo(() => result.data.filter((store) => store.status !== 'closed'), [result.data]);
  return { ...result, data };
}

/** One store, live; null when it does not exist. */
export function useStore(storeId: string | null | undefined) {
  return useLiveQuery(queries.store(storeId));
}

/** A store's listed products, paged, optionally by category or in-store search. */
export function useStoreProducts(storeId: string | null | undefined, params: StoreProductsParams = {}) {
  return usePagedQuery(queries.storeProducts(storeId, params));
}

/** Reviews of a store, newest first, paged. */
export function useStoreReviews(storeId: string | null | undefined) {
  return usePagedQuery(queries.storeReviews(storeId), { live: false });
}

/** The customer's own review of one store order, or null. */
export function useMyStoreReview(
  storeId: string | null | undefined,
  storeOrderId: string | null | undefined,
) {
  return useLiveQuery(queries.myReview(storeId, storeOrderId));
}

/** A store as a card shows it: distance from the current site and `storeAvailability()`. */
export interface StoreView {
  store: WithId<Store>;
  /** Straight-line metres from the current site; null without a site. */
  distanceM: number | null;
  /** Estimated road distance in tenths of a km (pricing's measure); null without a site. */
  roadTenths: number | null;
  availability: StoreAvailability;
}

/** Distance and promise of one store from `site`; `vehicleClass` is the cart's for that store, else pickup truck. */
export function storeView(
  store: WithId<Store>,
  site: LatLng | null,
  now: number,
  vehicleClass: VehicleClass = 'pickup',
): StoreView {
  const tenths = site ? roadTenths(store.location, site) : null;
  return {
    store,
    distanceM: site ? haversineMeters(store.location, site) : null,
    roadTenths: tenths,
    availability: storeAvailability(store, tenths == null ? null : { vehicleClass, roadTenths: tenths }, now),
  };
}

/**
 * Stores with their distance and promise from the current site (Home carousel, Stores tab, search
 * and listings). Recomputed every 30 s so promises stay true. Nearest first when a site is known.
 */
export function useStoreViews() {
  const stores = useStores();
  const { site } = useSite();
  const now = useNow(30_000);
  const location = site?.location ?? null;
  const views = useMemo(() => {
    const list = stores.data.map((store) => storeView(store, location, now));
    return location ? list.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0)) : list;
  }, [stores.data, location, now]);
  const byId = useMemo(() => new Map(views.map((view) => [view.store.id, view])), [views]);
  return { ...stores, views, byId, now };
}
