import type { Product } from '@instasupply/shared';
import { useMemo } from 'react';

import { useNow } from '@/hooks/useNow';
import { useSite } from '@/features/site/SiteProvider';
import { useStores } from '@/features/stores/hooks';

import { toListings, type Listing } from './listings';

/**
 * Products joined to their stores and measured from the current site (distance, promise). Products
 * of stores the store list hides (closed) are dropped. `storesLoading` lets a list wait for the
 * stores before it ranks by distance.
 */
export function useListings(products: readonly Product[]): {
  listings: Listing[];
  storesLoading: boolean;
  storesError: unknown;
  retryStores: () => void;
} {
  const stores = useStores();
  const { site } = useSite();
  const now = useNow(30_000);
  const byId = useMemo(() => new Map(stores.data.map((store) => [store.id, store])), [stores.data]);
  const location = site?.location ?? null;
  const listings = useMemo(() => {
    const known = stores.loading ? products : products.filter((product) => byId.has(product.storeId));
    return toListings(known, byId, location, now);
  }, [products, byId, location, now, stores.loading]);
  return { listings, storesLoading: stores.loading, storesError: stores.error, retryStores: stores.retry };
}
