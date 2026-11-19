import type { Category, Product, Store, StoreReview } from '@instasupply/shared';

import type { CategoryInput, ProductInput, ProductPatch, ReviewInput, WithId } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

/** `{storeId}--{skuSlug}` (MARKETPLACE §1.1), the id a new product is created under. */
export { productIdFor } from '@instasupply/shared';

export const catalogPaths = {
  categories: '/categories',
  category: (id: string) => `/categories/${seg(id)}`,
  categoriesReorder: '/categories/reorder',
  stores: '/stores',
  store: (storeId: string) => `/stores/${seg(storeId)}`,
  storeSettings: (storeId: string) => `/stores/${seg(storeId)}/settings`,
  storeReviews: (storeId: string) => `/stores/${seg(storeId)}/reviews`,
  storeReview: (storeId: string, storeOrderId: string) => `/stores/${seg(storeId)}/reviews/${seg(storeOrderId)}`,
  products: '/products',
  product: (productId: string) => `/products/${seg(productId)}`,
  productStock: (productId: string) => `/products/${seg(productId)}/stock-adjust`,
} as const;

export function createReviews(ctx: ResourceContext) {
  const families = (storeId: string, storeOrderId: string) => [
    ['store-reviews', storeId],
    ['store-review', storeId],
    ['store', storeId],
    ['stores'],
    ['store-order', storeOrderId],
  ];
  return {
    /** The server sets `authorName` and recomputes the store's rating in the same transaction. */
    save: (storeId: string, storeOrderId: string, review: ReviewInput) =>
      writeThen(ctx, families(storeId, storeOrderId), () =>
        ctx.rest.put<WithId<StoreReview>>(catalogPaths.storeReview(storeId, storeOrderId), review),
      ),
    remove: (storeId: string, storeOrderId: string) =>
      writeThen(ctx, families(storeId, storeOrderId), () =>
        ctx.rest.delete(catalogPaths.storeReview(storeId, storeOrderId)),
      ),
  };
}

export function createProducts(ctx: ResourceContext) {
  return {
    /** Create under `productIdFor(storeId, sku)`; `already-exists` when the SKU is taken. */
    create: (productId: string, product: ProductInput) =>
      writeThen(ctx, [['products'], ['product']], () =>
        ctx.rest.put<Product>(catalogPaths.product(productId), product),
      ),
    update: (productId: string, patch: ProductPatch) =>
      writeThen(ctx, [['products'], ['product', productId]], () =>
        ctx.rest.patch<Product>(catalogPaths.product(productId), patch),
      ),
    /** Not retry-safe (PLATFORM §4.5): after a lost answer, reload the product before adjusting again. */
    adjustStock: (productId: string, delta: number) =>
      writeThen(ctx, [['products'], ['product', productId]], () =>
        ctx.rest.post<Product>(catalogPaths.productStock(productId), { delta }),
      ),
    remove: (productId: string) =>
      writeThen(ctx, [['products'], ['product', productId]], () =>
        ctx.rest.delete(catalogPaths.product(productId)),
      ),
  };
}

export function createCategories(ctx: ResourceContext) {
  const families = [['categories']] as const;
  return {
    save: (id: string, values: CategoryInput) =>
      writeThen(ctx, families, () => ctx.rest.put<Category>(catalogPaths.category(id), values)),
    update: (id: string, patch: Partial<CategoryInput>) =>
      writeThen(ctx, families, () => ctx.rest.patch<Category>(catalogPaths.category(id), patch)),
    remove: (id: string) => writeThen(ctx, families, () => ctx.rest.delete(catalogPaths.category(id))),
    reorder: (ids: readonly string[]) =>
      writeThen(ctx, families, () => ctx.rest.post(catalogPaths.categoriesReorder, { ids })),
  };
}

export type StoreDoc = WithId<Store>;
