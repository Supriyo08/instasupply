import type { WithId } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import type { Category, Product } from '@instasupply/shared';

import { queries } from '@/lib/api';

export type ProductRecord = Product;
export type CategoryRecord = WithId<Category>;

/** One store's whole catalogue, A–Z (portal and the store's Catalog tab): a complete live list. */
export function useStoreProducts(storeId: string | null | undefined) {
  return useLiveQuery(queries.portalCatalog(storeId));
}

/** Ops catalogue across stores, filtered by the server (`storeId`, `categoryId`, `q`, `active`, …), paged. */
export function useOpsProducts(filters: Record<string, string | number | boolean | null | undefined> = {}) {
  return usePagedQuery(queries.opsCatalog(filters));
}

/** Categories in shop order (public, cached for every page). */
export function useCategories() {
  return useLiveQuery(queries.categories());
}
