/**
 * The caller's own data (docs/PLATFORM.md §5.3.3): PATCH /me, jobsites, cards, favourites, "Buy again" and the
 * P1 cart. These replace client writes that security rules validated (MARKETPLACE §6.3). Devices and location
 * are not here (§15.2: the device and location endpoints belong to other rows of the work breakdown).
 */
import type {
  Cart,
  CartInput,
  Favorite,
  Jobsite,
  MeResponse,
  Page,
  Product,
  ProfilePatch,
  SavedCard,
  WithId,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../../platform/auth/actor';
import { requireAuth, requireCustomer } from '../../platform/auth/policies';
import type { RequestContext } from '../../platform/http/context';
import { withTransaction } from '../../platform/db/tx';
import {
  ApiError,
  failCode,
  failedPrecondition,
  invalidArgument,
  notFound,
  permissionDenied,
} from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { isRequestId } from '../../platform/ids';
import { requireReadyFile } from '../../platform/storage/files.service';
import { loadMe } from '../auth/serializers';
import { countCards, deleteCard, findCard, listCards, MAX_CARDS, upsertCard } from './cards.repository';
import {
  addFavorite,
  buyAgain,
  deleteCart,
  favoriteKey,
  findCart,
  listFavorites,
  removeFavorite,
  saveCart,
  updateProfile,
} from './favorites.repository';
import {
  countJobsites,
  deleteJobsite,
  findJobsite,
  listJobsites,
  lockOwner,
  MAX_JOBSITES,
  upsertJobsite,
} from './jobsites.repository';
import { CardInputSchema, CartInputSchema, JobsiteInputSchema, ProfilePatchSchema } from './schemas';

const uuidParam = z.object({
  id: z.string().refine((value) => isRequestId(value), 'Use a UUIDv4 created with api.newRequestId().'),
});
const productParam = z.object({ productId: idParam });

/** `auth` with a role: an account that has not chosen customer or driver yet has no profile to edit. */
function requireProfileOwner(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.role === null) permissionDenied('Finish creating your account first.');
  return actor;
}

const single = <T>(items: T[]): Page<T> => ({ items, nextCursor: null });

export function registerAccountRoutes(app: FastifyInstance): void {
  // ---------- PATCH /me ----------
  defineRoute<Record<string, never>, Record<string, never>, ProfilePatch, MeResponse>(app, {
    method: 'PATCH',
    url: '/me',
    policy: requireProfileOwner,
    body: ProfilePatchSchema,
    handler: async (ctx, { body }, actor) => {
      const me = actor!;
      if ((body.companyName !== undefined || body.accountType !== undefined) && me.role !== 'customer') {
        invalidArgument('Company and account type are for customer accounts.', {
          fields: { companyName: 'customers only' },
        });
      }
      if (typeof body.photoPath === 'string') {
        await requireReadyFile(ctx.deps.pool, body.photoPath, {
          purpose: 'avatar',
          scopeId: me.uid,
          uploadedBy: me.uid,
        });
      }
      await withTransaction(ctx.deps, (tx) => updateProfile(tx, me.uid, body));
      return loadMe(ctx.deps.pool, me.uid, ctx.origin, ctx.deps.clock.now());
    },
  });

  // ---------- jobsites ----------
  defineRoute<Record<string, never>, z.infer<typeof pageQuerySchema>, undefined, Page<Jobsite>>(app, {
    method: 'GET',
    url: '/me/jobsites',
    policy: requireCustomer,
    query: pageQuerySchema,
    handler: async (ctx, _input, actor) => single(await listJobsites(ctx.deps.pool, actor!.uid)),
  });

  defineRoute(app, {
    method: 'PUT',
    url: '/me/jobsites/:id',
    policy: requireCustomer,
    params: uuidParam,
    body: JobsiteInputSchema,
    handler: async (ctx, { params, body }, actor): Promise<Jobsite> => {
      const uid = actor!.uid;
      if (body.id !== undefined && body.id !== params.id) {
        invalidArgument('The jobsite id in the body must match the path.', { fields: { id: 'mismatch' } });
      }
      const existing = await findJobsite(ctx.deps.pool, params.id);
      if (existing && existing.userId !== uid) taken();
      const { id: _id, isDefault, ...fields } = body;
      const saved = await withTransaction(ctx.deps, async (tx) => {
        await lockOwner(tx, uid);
        const count = await countJobsites(tx, uid);
        if (!existing && count >= MAX_JOBSITES) {
          failedPrecondition(`You can save up to ${MAX_JOBSITES} jobsites.`);
        }
        // The first jobsite is always the default.
        return upsertJobsite(tx, uid, params.id, fields, isDefault || count === 0);
      });
      return saved ?? taken();
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/me/jobsites/:id',
    policy: requireCustomer,
    params: z.object({ id: idParam }),
    status: 204,
    handler: async (ctx, { params }, actor) => {
      const uid = actor!.uid;
      const existing = await findJobsite(ctx.deps.pool, params.id);
      if (!existing || existing.userId !== uid) notFound('That jobsite no longer exists.');
      await withTransaction(ctx.deps, async (tx) => {
        await lockOwner(tx, uid);
        await deleteJobsite(tx, uid, params.id);
      });
    },
  });

  // ---------- cards ----------
  defineRoute<Record<string, never>, z.infer<typeof pageQuerySchema>, undefined, Page<SavedCard>>(app, {
    method: 'GET',
    url: '/me/cards',
    policy: requireCustomer,
    query: pageQuerySchema,
    handler: async (ctx, _input, actor) => single(await listCards(ctx.deps.pool, actor!.uid)),
  });

  defineRoute(app, {
    method: 'PUT',
    url: '/me/cards/:id',
    policy: requireCustomer,
    params: uuidParam,
    body: CardInputSchema,
    handler: async (ctx, { params, body }, actor): Promise<SavedCard> => {
      if (ctx.deps.config.PAYMENTS_MODE !== 'test') {
        failCode('PAYMENTS_DISABLED', "Card payments aren't available yet.");
      }
      const uid = actor!.uid;
      if (body.id !== undefined && body.id !== params.id) {
        invalidArgument('The card id in the body must match the path.', { fields: { id: 'mismatch' } });
      }
      const existing = await findCard(ctx.deps.pool, params.id);
      if (existing && existing.userId !== uid) taken();
      const { id: _id, isDefault, ...card } = body;
      const saved = await withTransaction(ctx.deps, async (tx) => {
        await lockOwner(tx, uid);
        const count = await countCards(tx, uid);
        if (!existing && count >= MAX_CARDS) failedPrecondition(`You can save up to ${MAX_CARDS} cards.`);
        return upsertCard(tx, uid, params.id, card, isDefault || count === 0);
      });
      return saved ?? taken();
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/me/cards/:id',
    policy: requireCustomer,
    params: z.object({ id: idParam }),
    status: 204,
    handler: async (ctx, { params }, actor) => {
      const uid = actor!.uid;
      const existing = await findCard(ctx.deps.pool, params.id);
      if (!existing || existing.userId !== uid) notFound('That card no longer exists.');
      await withTransaction(ctx.deps, async (tx) => {
        await lockOwner(tx, uid);
        await deleteCard(tx, uid, params.id);
      });
    },
  });

  // ---------- favourites ----------
  defineRoute<Record<string, never>, z.infer<typeof pageQuerySchema>, undefined, Page<WithId<Favorite>>>(
    app,
    {
      method: 'GET',
      url: '/me/favorites',
      policy: requireCustomer,
      query: pageQuerySchema,
      handler: async (ctx, { query }, actor) => {
        let after: { createdAt: number; productId: string } | null = null;
        if (query.cursor) {
          const [sort, id] = decodeCursor(query.cursor);
          if (typeof sort !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
          after = { createdAt: sort, productId: id };
        }
        const { items } = await listFavorites(ctx.deps.pool, actor!.uid, query.limit, after);
        return readPage(items, query.limit, (item) => item, favoriteKey);
      },
    },
  );

  defineRoute(app, {
    method: 'PUT',
    url: '/me/favorites/:productId',
    policy: requireCustomer,
    params: productParam,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      const uid = actor!.uid;
      const added = await withTransaction(ctx.deps, async (tx) => {
        await lockOwner(tx, uid);
        return addFavorite(tx, uid, params.productId);
      });
      if (!added) failedPrecondition('You can save up to 500 materials.');
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/me/favorites/:productId',
    policy: requireCustomer,
    params: productParam,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      await removeFavorite(ctx.deps.pool, actor!.uid, params.productId);
    },
  });

  // ---------- buy again ----------
  defineRoute<Record<string, never>, Record<string, never>, undefined, Page<Product>>(app, {
    method: 'GET',
    url: '/me/buy-again',
    policy: requireCustomer,
    handler: async (ctx, _input, actor) => single(await buyAgain(ctx.deps.pool, actor!.uid, ctx.origin)),
  });

  // ---------- cart (P1) ----------
  defineRoute<Record<string, never>, Record<string, never>, undefined, Cart>(app, {
    method: 'GET',
    url: '/me/cart',
    policy: requireCustomer,
    handler: async (ctx, _input, actor) =>
      (await findCart(ctx.deps.pool, actor!.uid)) ?? notFound('There is no saved cart.'),
  });

  defineRoute<Record<string, never>, Record<string, never>, CartInput, Cart>(app, {
    method: 'PUT',
    url: '/me/cart',
    policy: requireCustomer,
    body: CartInputSchema,
    handler: async (ctx, { body }, actor) => {
      const stores = new Set(body.lines.map((line) => line.storeId));
      if (body.unloadHelpStoreIds.some((storeId) => !stores.has(storeId))) {
        invalidArgument('Labourer help can only be asked for stores in the cart.', {
          fields: { unloadHelpStoreIds: 'not in the cart' },
        });
      }
      return saveCart(ctx.deps.pool, actor!.uid, body, ctx.deps.clock.now());
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/me/cart',
    policy: requireCustomer,
    status: 204,
    handler: async (ctx, _input, actor) => {
      await deleteCart(ctx.deps.pool, actor!.uid);
    },
  });
}

/** D17: an id of another account is a generic already-exists, never a hint at whose it is. */
function taken(): never {
  throw new ApiError('already-exists', 'That id is already in use. Create a new one and try again.');
}
