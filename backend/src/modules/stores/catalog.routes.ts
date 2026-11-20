/** The REST endpoints of the catalogue and stores (docs/PLATFORM.md §5.3.4, §7.3, §7.4). HTTP only. */
import {
  searchKeysFor,
  type Category,
  type Page,
  type Product,
  type Store,
  type StorePrivateSettings,
  type StoreReview,
  type WithId,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  requireAdmin,
  requireAuth,
  requireCustomer,
  requireStaff,
  resolveStoreScope,
} from '../../platform/auth/policies';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { isStaffOrOwner } from './access';
import { listCategories, toCategory } from './categories.repository';
import { patchCategory, putCategory, removeCategory, reorderCategories } from './categories.service';
import {
  findProduct,
  findProductsByIds,
  listProducts,
  toProduct,
  type ProductFilter,
} from './products.repository';
import { adjustProductStock, createProduct, removeProduct, updateProduct } from './products.service';
import { findReview, listReviews, toReview } from './reviews.repository';
import { removeReview, saveReview } from './reviews';
import {
  CategoryInputSchema,
  CategoryPatchSchema,
  categoryParams,
  ProductInputSchema,
  productListQuery,
  ProductPatchSchema,
  ReorderCategoriesSchema,
  ReviewInputSchema,
  reviewListQuery,
  StockAdjustSchema,
  storeListQuery,
} from './schemas';
import { findStore, findStoreSettings, listStores, toStore } from './stores.repository';

const storeParams = z.object({ storeId: idParam });
const reviewParams = z.object({ storeId: idParam, storeOrderId: idParam });
const productParams = z.object({ productId: idParam });

const badCursor = (): never => invalidArgument('That page cursor is not valid. Reload the list.');

function stringCursor(cursor: string | undefined): { value: string; id: string } | null {
  if (!cursor) return null;
  const [value, id] = decodeCursor(cursor);
  return typeof value === 'string' ? { value, id } : badCursor();
}

function numberCursor(cursor: string | undefined): { value: number; id: string } | null {
  if (!cursor) return null;
  const [value, id] = decodeCursor(cursor);
  return typeof value === 'number' ? { value, id } : badCursor();
}

export function registerCatalogRoutes(app: FastifyInstance): void {
  // ---------- categories ----------

  defineRoute(app, {
    method: 'GET',
    url: '/categories',
    policy: 'public',
    query: pageQuerySchema,
    handler: async (ctx, { query }): Promise<Page<Category>> => {
      const after = numberCursor(query.cursor);
      const rows = await listCategories(
        ctx.deps.pool,
        after ? { sortOrder: after.value, id: after.id } : null,
        query.limit,
      );
      return readPage(rows, query.limit, toCategory, (row) => [row.doc.sortOrder, row.id]);
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: '/categories/:id',
    policy: requireStaff,
    params: categoryParams,
    body: CategoryInputSchema,
    handler: (ctx, { params, body }) => putCategory(ctx.deps, params.id, body),
  });

  defineRoute(app, {
    method: 'PATCH',
    url: '/categories/:id',
    policy: requireStaff,
    params: categoryParams,
    body: CategoryPatchSchema,
    handler: (ctx, { params, body }) => patchCategory(ctx.deps, params.id, body),
  });

  defineRoute(app, {
    method: 'POST',
    url: '/categories/reorder',
    policy: requireStaff,
    body: ReorderCategoriesSchema,
    status: 204,
    handler: (ctx, { body }) => reorderCategories(ctx.deps, body.ids),
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/categories/:id',
    policy: requireAdmin,
    params: categoryParams,
    status: 204,
    handler: (ctx, { params }) => removeCategory(ctx.deps, params.id),
  });

  // ---------- stores ----------

  defineRoute(app, {
    method: 'GET',
    url: '/stores',
    policy: 'public',
    query: storeListQuery,
    handler: async (ctx, { query }): Promise<Page<Store>> => {
      const after = stringCursor(query.cursor);
      const rows = await listStores(
        ctx.deps.pool,
        { marketId: query.marketId, statuses: query.status ?? null },
        after ? { name: after.value, id: after.id } : null,
        query.limit,
      );
      return readPage(
        rows,
        query.limit,
        (row) => toStore(row, ctx.origin),
        (row) => [row.doc.name, row.id],
      );
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/stores/:storeId',
    policy: 'public',
    params: storeParams,
    handler: async (ctx, { params }): Promise<Store> => {
      const store = await findStore(ctx.deps.pool, params.storeId);
      if (!store) notFound('That store does not exist.');
      return toStore(store, ctx.origin);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/stores/:storeId/settings',
    policy: requireAuth,
    params: storeParams,
    handler: async (ctx, { params }, actor): Promise<StorePrivateSettings> => {
      if (!isStaffOrOwner(actor!, params.storeId)) permissionDenied();
      const settings = await findStoreSettings(ctx.deps.pool, params.storeId);
      if (!settings) notFound('That store does not exist.');
      return settings;
    },
  });

  // ---------- reviews ----------

  defineRoute(app, {
    method: 'GET',
    url: '/stores/:storeId/reviews',
    policy: 'public',
    params: storeParams,
    query: reviewListQuery,
    handler: async (ctx, { params, query }): Promise<Page<WithId<StoreReview>>> => {
      const after = numberCursor(query.cursor);
      const rows = await listReviews(
        ctx.deps.pool,
        params.storeId,
        after ? { updatedAt: after.value, id: after.id } : null,
        query.limit,
      );
      return readPage(rows, query.limit, toReview, (row) => [row.updated_at, row.id]);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/stores/:storeId/reviews/:storeOrderId',
    policy: 'public',
    params: reviewParams,
    handler: async (ctx, { params }): Promise<WithId<StoreReview>> => {
      const row = await findReview(ctx.deps.pool, params.storeId, params.storeOrderId);
      if (!row) notFound('That order has no review.');
      return toReview(row);
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: '/stores/:storeId/reviews/:storeOrderId',
    policy: requireCustomer,
    params: reviewParams,
    body: ReviewInputSchema,
    handler: (ctx, { params, body }, actor) => saveReview(ctx.deps, actor!, { ...params, ...body }),
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/stores/:storeId/reviews/:storeOrderId',
    policy: requireAuth,
    params: reviewParams,
    status: 204,
    handler: (ctx, { params }, actor) => removeReview(ctx.deps, actor!, params),
  });

  // ---------- products ----------

  defineRoute(app, {
    method: 'GET',
    url: '/products',
    policy: 'public',
    query: productListQuery,
    handler: async (ctx, { query }): Promise<Page<Product>> => {
      const toApi = (row: Parameters<typeof toProduct>[0]) => toProduct(row, ctx.origin);
      if (query.ids) {
        const rows = await findProductsByIds(ctx.deps.pool, query.ids);
        return { items: rows.map(toApi), nextCursor: null };
      }
      const listed = query.listed === 'true';
      let storeId = query.storeId;
      if (listed) {
        if (query.active !== undefined || query.lowStock || query.estimated) {
          invalidArgument('The filters active, lowStock and estimated are for the store catalogue only.', {
            fields: { listed: 'leave listed out to use these filters' },
          });
        }
      } else {
        // The portal and ops catalogue (index 6): staff, or a member of the store (§7.4).
        storeId = resolveStoreScope(requireAuth(ctx), query.storeId);
      }
      if (query.sort === 'priceCents:asc' && !query.familyKey) {
        invalidArgument('Sorting by price needs a familyKey.', { fields: { sort: 'needs familyKey' } });
      }
      const filter: ProductFilter = {
        listed,
        ...(storeId !== undefined ? { storeId } : {}),
        ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
        ...(query.familyKey !== undefined ? { familyKey: query.familyKey } : {}),
        ...(query.featured ? { featured: true } : {}),
        ...(query.inStock ? { inStock: true } : {}),
        ...(query.active !== undefined ? { active: query.active } : {}),
        ...(query.lowStock ? { lowStock: true } : {}),
        ...(query.estimated ? { estimated: true } : {}),
      };
      if (query.q !== undefined) {
        const keys = searchKeysFor(query.q);
        if (keys.length === 0) return { items: [], nextCursor: null };
        filter.searchKeys = keys;
      }
      const after = query.sort === 'priceCents:asc' ? numberCursor(query.cursor) : stringCursor(query.cursor);
      const rows = await listProducts(ctx.deps.pool, filter, query.sort, after, query.limit);
      return readPage(rows, query.limit, toApi, (row) => [
        query.sort === 'priceCents:asc' ? row.price_cents : row.name_sort,
        row.id,
      ]);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/products/:productId',
    policy: 'public',
    params: productParams,
    handler: async (ctx, { params }): Promise<Product> => {
      const row = await findProduct(ctx.deps.pool, params.productId);
      if (!row) notFound('That product does not exist.');
      return toProduct(row, ctx.origin);
    },
  });

  defineRoute(app, {
    method: 'PUT',
    url: '/products/:productId',
    policy: requireAuth,
    params: productParams,
    body: ProductInputSchema,
    handler: (ctx, { params, body }, actor) =>
      createProduct(ctx.deps, actor!, params.productId, body, ctx.origin),
  });

  defineRoute(app, {
    method: 'PATCH',
    url: '/products/:productId',
    policy: requireAuth,
    params: productParams,
    body: ProductPatchSchema,
    handler: (ctx, { params, body }, actor) =>
      updateProduct(ctx.deps, actor!, params.productId, body, ctx.origin),
  });

  defineRoute(app, {
    method: 'POST',
    url: '/products/:productId/stock-adjust',
    policy: requireAuth,
    params: productParams,
    body: StockAdjustSchema,
    handler: (ctx, { params, body }, actor) =>
      adjustProductStock(ctx.deps, actor!, params.productId, body.delta, ctx.origin),
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/products/:productId',
    policy: requireAuth,
    params: productParams,
    status: 204,
    handler: (ctx, { params }, actor) => removeProduct(ctx.deps, actor!, params.productId),
  });
}
