import type { Category, Product, PublicTracking, Store, StoreReview } from '@instasupply/shared';

import type { WithId } from '../contract';
import { canonicalJson } from '../ids';
import { catalogPaths } from '../resources/catalog';
import { deliveryPaths } from '../resources/deliveries';
import { readAll } from '../rest';
import { topics } from '../topics';
import type { QueryDescriptor } from '../query/types';

import { docQuery, idOrNull, listQuery, pagedQuery, replaceWithPayload } from './helpers';

/** The market every store list is scoped to (MARKETPLACE §1.1). */
const MARKET_ID = 'gta';
/** `GET /products?ids=` takes at most this many per request (PLATFORM §4.7 allows 100; CLIENTS §4.1 uses 50). */
const IDS_PER_REQUEST = 50;

export interface ProductSearchParams {
  q?: string | null;
  categoryId?: string | null;
  storeId?: string | null;
  inStock?: boolean | null;
}

export interface StoreProductsParams {
  categoryId?: string | null;
  q?: string | null;
}

/** The store of a product id `{storeId}--{skuSlug}`. */
function storeOfProduct(productId: string): string | null {
  const at = productId.indexOf('--');
  return at > 0 ? productId.slice(0, at) : null;
}

export const publicQueries = {
  categories: () =>
    listQuery<Category>(['categories'], true, catalogPaths.categories, {}, {
      auth: 'none',
      topics: [topics.categories()],
      pollS: 300,
    }),

  stores: () =>
    listQuery<WithId<Store>>(['stores'], true, catalogPaths.stores, { marketId: MARKET_ID }, {
      auth: 'none',
      topics: [topics.stores()],
      pollS: 60,
    }),

  store: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return docQuery<WithId<Store>>(['store', id], id !== null, () => catalogPaths.store(id ?? ''), {
      auth: 'none',
      topics: id ? [topics.store(id)] : [],
      pollS: 60,
    });
  },

  storeReviews: (storeId: string | null | undefined) => {
    const id = idOrNull(storeId);
    return pagedQuery<WithId<StoreReview>>(
      ['store-reviews', id],
      id !== null,
      catalogPaths.storeReviews(id ?? ''),
      { sort: 'updatedAt:desc' },
      { auth: 'none' },
    );
  },

  product: (productId: string | null | undefined) => {
    const id = idOrNull(productId);
    return docQuery<Product>(['product', id], id !== null, () => catalogPaths.product(id ?? ''), {
      auth: 'none',
      topics: id ? [topics.product(id)] : [],
      pollS: 30,
    });
  },

  productsByIds: (ids: readonly string[] | null | undefined): QueryDescriptor<Product[]> => {
    const sorted = [...new Set(ids ?? [])].sort();
    const stores = [...new Set(sorted.map(storeOfProduct).filter((s): s is string => s !== null))];
    const enabled = sorted.length > 0;
    return {
      key: ['products', 'ids', sorted.join(',')],
      enabled,
      auth: 'none',
      empty: [],
      topics: stores.map((storeId) => topics.storeProducts(storeId)),
      pollMs: 30_000,
      async fetch({ client, signal }) {
        const out: Product[] = [];
        for (let i = 0; i < sorted.length; i += IDS_PER_REQUEST) {
          const chunk = sorted.slice(i, i + IDS_PER_REQUEST);
          out.push(
            ...(await readAll<Product>(client, catalogPaths.products, {
              query: { ids: chunk },
              signal,
              auth: 'none',
              limit: IDS_PER_REQUEST,
            })),
          );
        }
        return out;
      },
    };
  },

  productSearch: (params: ProductSearchParams) =>
    listQuery<Product>(
      ['products', 'search', canonicalJson(params)],
      true,
      catalogPaths.products,
      {
        listed: true,
        q: params.q,
        categoryId: params.categoryId,
        storeId: params.storeId,
        inStock: params.inStock ?? undefined,
      },
      { auth: 'none', limit: 40, follow: false, staleMs: 30_000 },
    ),

  featuredProducts: (limit: number) =>
    listQuery<Product>(
      ['products', 'featured', limit],
      true,
      catalogPaths.products,
      { listed: true, featured: true, sort: 'name:asc' },
      { auth: 'none', limit, follow: false },
    ),

  familyOffers: (familyKey: string | null | undefined) => {
    const key = idOrNull(familyKey);
    return listQuery<Product>(
      ['products', 'family', key],
      key !== null,
      catalogPaths.products,
      { listed: true, familyKey: key, sort: 'priceCents:asc' },
      { auth: 'none' },
    );
  },

  storeProducts: (storeId: string | null | undefined, params: StoreProductsParams = {}) => {
    const id = idOrNull(storeId);
    return pagedQuery<Product>(
      ['products', 'store', id, params.categoryId ?? null, params.q ?? null],
      id !== null,
      catalogPaths.products,
      { storeId: id, listed: true, categoryId: params.categoryId, q: params.q, sort: 'name:asc' },
      { auth: 'none', topics: id ? [topics.storeProducts(id)] : [], pollS: 60 },
    );
  },

  tracking: (token: string | null | undefined) => {
    const t = idOrNull(token);
    return docQuery<PublicTracking>(['tracking', t], t !== null, () => deliveryPaths.tracking(t ?? ''), {
      auth: 'none',
      topics: t ? [topics.tracking(t)] : [],
      pollS: 5,
      reduce: replaceWithPayload,
    });
  },
};
