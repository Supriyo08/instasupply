import { queries } from '@instasupply/api-client';
import { useApiQuery, useLiveQuery } from '@instasupply/api-client/react';
import type { Category } from '@instasupply/shared';
import { useMemo } from 'react';

import { fallbackTint } from '@/theme/tokens';

/** `GET /products` search filters (`q`, `categoryId`, `storeId`, `inStock`). */
export type ProductSearchParams = Parameters<typeof queries.productSearch>[0];

/**
 * Catalogue reads (docs/CLIENTS.md §4.1). Every hook returns the api-client `QueryResult`:
 * `{ data, loading, error, retry, refreshing, updatedAt }`. Give `retry` to `ErrorState`.
 */

/** Active categories by `sortOrder`. */
export function useCategories() {
  const result = useLiveQuery(queries.categories());
  const data = useMemo(() => result.data.filter((category) => category.active), [result.data]);
  return { ...result, data };
}

/** One category from the (cached) category list; `data` is null while loading or when unknown. */
export function useCategory(id: string | null | undefined) {
  const result = useCategories();
  const data: Category | null = useMemo(
    () => (id ? (result.data.find((category) => category.id === id) ?? null) : null),
    [id, result.data],
  );
  return { ...result, data };
}

/** One product, live (`product:{id}`); null when it does not exist. */
export function useProduct(productId: string | null | undefined) {
  return useLiveQuery(queries.product(productId));
}

/** Products by id, unordered, only those that exist (cart, saved items). */
export function useProductsByIds(ids: readonly string[]) {
  return useLiveQuery(queries.productsByIds(ids));
}

/**
 * Server-side search over listed products (`q`, category, store, in stock), at most 40. Grouping by
 * `familyKey` and ranking by distance stay in the app (MARKETPLACE §7.3 search row).
 */
export function useProductSearch(params: ProductSearchParams, options?: { enabled?: boolean }) {
  return useApiQuery(queries.productSearch(params), options);
}

/** Featured listings for Home ("Popular near you"). */
export function useFeaturedProducts(limit = 12) {
  return useApiQuery(queries.featuredProducts(limit));
}

/** The same item at every store that sells it, cheapest first ("Also at"). */
export function useFamilyOffers(familyKey: string | null | undefined) {
  return useApiQuery(queries.familyOffers(familyKey));
}

/** Top products of the last 10 orders (Home "Buy again"); empty for guests. */
export function useBuyAgain(uid: string | null | undefined) {
  return useApiQuery(queries.buyAgain(uid));
}

/** The pastel behind a product's or category's art: the category's `tint`, else the brand tint. */
export function useCategoryTint(categoryId: string | null | undefined): string {
  const { data } = useCategory(categoryId);
  return data?.tint ?? fallbackTint;
}
