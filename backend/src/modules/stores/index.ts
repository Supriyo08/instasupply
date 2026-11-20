/**
 * Catalogue and stores (docs/PLATFORM.md §2.1 `stores/`, §5.3.4, §15.2 workstream `catalog`): categories,
 * stores and their private settings, store reviews, products, and the commands createStore,
 * updateStoreSettings and updateStoreProfile. The old triggers onProductWritten, onStoreWritten and
 * onStoreReviewWritten are functions called inside the writing transaction (§9.4).
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { requireAdmin, requireAuth } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import { registerCatalogRoutes } from './catalog.routes';
import {
  CreateStoreRequestSchema,
  UpdateStoreProfileRequestSchema,
  UpdateStoreSettingsRequestSchema,
} from './schemas';
import { createStore, updateStoreProfile, updateStoreSettings } from './store-admin';

export { deriveProductColumns, searchTermsFor } from './product-derivation';
export { fanOutStore } from './store-fanout';
export { canWriteProduct } from './access';
export { authorNameFor } from './reviews';
// Read and write helpers for the seed and other modules (docs/PLATFORM.md §2.2: the seed writes the catalogue
// through repositories). Each write publishes its live topics, like the endpoints do.
export { toStore, ratingOf, insertStore, findStore, type StoreDoc } from './stores.repository';
export {
  toProduct,
  insertProduct,
  findProduct,
  type ProductDoc,
  type ProductColumns,
  type ProductRow,
} from './products.repository';
export { toCategory, upsertCategory } from './categories.repository';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerCatalogRoutes(app);

  defineCommand({
    name: 'createStore',
    policy: requireAdmin,
    schema: CreateStoreRequestSchema,
    handler: async (ctx, request) => {
      await createStore(ctx.deps, request);
      return { ok: true };
    },
  });

  defineCommand({
    name: 'updateStoreSettings',
    policy: requireAdmin,
    schema: UpdateStoreSettingsRequestSchema,
    handler: async (ctx, request) => {
      await updateStoreSettings(ctx.deps, request);
      return { ok: true };
    },
  });

  defineCommand({
    name: 'updateStoreProfile',
    // Staff; the owner for every field; any member for acceptingOrders alone (checked against the store id).
    policy: requireAuth,
    schema: UpdateStoreProfileRequestSchema,
    handler: async (ctx, request, actor) => {
      await updateStoreProfile(ctx.deps, actor!, request);
      return { ok: true };
    },
  });
}
