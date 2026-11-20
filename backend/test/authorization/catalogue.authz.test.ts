/**
 * Authorization of the catalogue (docs/PLATFORM.md §7.3, §12.4; MARKETPLACE §6.2, §6.3, §13.2): categories,
 * stores, store settings, reviews and products, one allowed and one denied case per endpoint for the actors
 * of MARKETPLACE §13.2: anonymous, customers A and B, the owner and the staff of store X, a supplier of store
 * Y, an active and a pending driver, a dispatcher and an admin.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { Page, Product } from '@instasupply/shared';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { createProduct, createStore } from '../support/fixtures';
import { command, del, expectError, expectOk, get, patch, post, put } from '../support/http';

const STORE_X = 'store-x';
const STORE_Y = 'store-y';

function productBody(sku: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sku,
    name: 'SPF stud 2×4×8',
    brand: null,
    categoryId: 'wood',
    unit: 'each',
    size: '2 in × 4 in × 8 ft',
    description: '',
    priceCents: 479,
    compareAtCents: null,
    stockOnHand: 100,
    maxPerOrder: null,
    weightKg: 4.5,
    dimsCm: { l: 244, w: 9, h: 4 },
    shipEstimated: false,
    active: true,
    imageKey: null,
    imagePath: null,
    ...overrides,
  };
}

const idFor = (storeId: string, sku: string) => `${storeId}--${sku.toLowerCase()}`;

const categoryBody = {
  name: 'Outdoors',
  iconKey: 'cat-outdoors',
  tint: '#E8F5DA',
  accent: '#2F6B3A',
  sortOrder: 25,
  defaultWeightKg: 20,
  defaultDimsCm: { l: 122, w: 61, h: 5 },
  synonyms: ['decking', 'fencing'],
  active: true,
};

async function insertStoreOrder(
  ctx: TestContext,
  customerId: string,
  storeId: string,
  status: string,
): Promise<string> {
  const orderId = randomUUID();
  const { rows } = await ctx.pool.query<{ n: string }>("SELECT nextval('order_number_seq')::text AS n");
  const number = `IS-${rows[0]!.n}`;
  const now = new Date(ctx.clock.now());
  await ctx.pool.query(
    `INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
    [
      orderId,
      JSON.stringify({
        number,
        customerId,
        source: 'cart',
        status: 'confirmed',
        needsAttention: false,
        payment: { status: 'authorized', captureDeadlineAt: null },
        current: { totalCents: 5000 },
      }),
      now,
    ],
  );
  await ctx.pool.query(
    `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, '{}'::jsonb, $3, $3)`,
    [
      `${orderId}-A`,
      JSON.stringify({
        orderId,
        storeId,
        customerId,
        number: `${number}-A`,
        letter: 'A',
        status,
        fulfilment: 'delivery',
        version: 3,
        deliveryId: null,
        timing: { respondBy: ctx.clock.now(), readyBy: ctx.clock.now(), readyByDate: '2026-11-19' },
        acceptOverdue: false,
        rated: false,
      }),
      now,
    ],
  );
  return `${orderId}-A`;
}

describe('catalogue authorization (§7.3; MARKETPLACE §13.2)', () => {
  let ctx: TestContext;
  let customerA: ActorClient;
  let customerB: ActorClient;
  let ownerX: ActorClient;
  let staffX: ActorClient;
  let supplierY: ActorClient;
  let driver: ActorClient;
  let pendingDriver: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;
  let productX: string;
  let heldX: string;

  before(async () => {
    ctx = await createTestContext();
    await createStore(ctx, { id: STORE_X, name: 'Store X' });
    await createStore(ctx, { id: STORE_Y, name: 'Store Y' });
    customerA = await newCustomer(ctx, { displayName: 'Ana Alvarez' });
    customerB = await newCustomer(ctx);
    ownerX = await newSupplier(ctx, { storeId: STORE_X, storeRole: 'owner' });
    staffX = await newSupplier(ctx, { storeId: STORE_X, storeRole: 'staff' });
    supplierY = await newSupplier(ctx, { storeId: STORE_Y, storeRole: 'owner' });
    driver = await newDriver(ctx);
    pendingDriver = await newDriver(ctx, { status: 'pending' });
    dispatcher = await newDispatcher(ctx);
    admin = await newAdmin(ctx);
    productX = (await createProduct(ctx, STORE_X, { sku: 'X-1' })).id;
    heldX = (await createProduct(ctx, STORE_X, { sku: 'X-HELD', reserved: 2 })).id;
  });
  after(() => ctx.close());

  describe('categories', () => {
    test('anyone reads; only staff write; only admins delete', async () => {
      const page = await expectOk(get<Page<unknown>>(ctx, '/categories?limit=500'));
      assert.equal(page.items.length, 25);
      await expectError(put(ctx, '/categories/outdoors', categoryBody), 'unauthenticated');
      for (const actor of [customerA, ownerX, driver]) {
        await expectError(actor.put('/categories/outdoors', categoryBody), 'permission-denied');
        await expectError(actor.patch('/categories/outdoors', { active: false }), 'permission-denied');
        await expectError(actor.post('/categories/reorder', { ids: ['wood'] }), 'permission-denied');
      }
      await expectOk(dispatcher.put('/categories/outdoors', categoryBody));
      await expectOk(admin.patch('/categories/outdoors', { synonyms: ['decking'] }));
      await expectError(dispatcher.put('/categories/not-a-category', categoryBody), 'invalid-argument');
      await expectError(
        dispatcher.patch('/categories/outdoors', { id: 'outdoors', name: 'X' }),
        'invalid-argument',
        undefined,
      );
      await expectError(dispatcher.del('/categories/outdoors'), 'permission-denied');
      await expectError(ownerX.del('/categories/outdoors'), 'permission-denied');
      await expectOk(admin.del('/categories/outdoors'), 204);
    });
  });

  describe('stores', () => {
    test('anyone reads stores; no client write exists besides the three commands', async () => {
      await expectOk(get(ctx, '/stores?marketId=gta'));
      await expectOk(get(ctx, `/stores/${STORE_X}`));
      await expectError(get(ctx, '/stores/no-such-store'), 'not-found');
      for (const method of ['PUT', 'PATCH', 'POST', 'DELETE'] as const) {
        const answer = await ctx.app.inject({
          method,
          url: `/api/v1/stores/${STORE_X}`,
          headers: { authorization: `Bearer ${admin.token}` },
          ...(method === 'DELETE' ? {} : { payload: { name: 'Hacked' } }),
        });
        assert.equal(answer.statusCode, 404, `${method} /stores/{id} is not a route`);
      }
    });

    test('createStore and updateStoreSettings: admin only', async () => {
      for (const actor of [customerA, ownerX, staffX, driver, dispatcher]) {
        await expectError(actor.call('createStore', { storeId: 'new-store' }), 'permission-denied');
        await expectError(
          actor.call('updateStoreSettings', { storeId: STORE_X, store: { status: 'closed' } }),
          'permission-denied',
        );
      }
      await expectError(command(ctx, 'updateStoreSettings', { storeId: STORE_X }), 'unauthenticated');
      await expectOk(admin.call('updateStoreSettings', { storeId: STORE_X, settings: { notes: 'VIP' } }));
    });

    test('updateStoreProfile: staff and the owner for every field, any member for acceptingOrders alone', async () => {
      await expectOk(
        ownerX.call('updateStoreProfile', { storeId: STORE_X, patch: { description: 'By the owner.' } }),
      );
      await expectOk(
        dispatcher.call('updateStoreProfile', { storeId: STORE_X, patch: { description: 'By dispatch.' } }),
      );
      await expectError(
        staffX.call('updateStoreProfile', { storeId: STORE_X, patch: { description: 'By staff.' } }),
        'permission-denied',
      );
      await expectError(
        staffX.call('updateStoreProfile', {
          storeId: STORE_X,
          patch: { acceptingOrders: false, prepMinutes: 10 },
        }),
        'permission-denied',
      );
      await expectOk(
        staffX.call('updateStoreProfile', { storeId: STORE_X, patch: { acceptingOrders: true } }),
      );
      for (const actor of [supplierY, customerA, driver]) {
        await expectError(
          actor.call('updateStoreProfile', { storeId: STORE_X, patch: { acceptingOrders: false } }),
          'permission-denied',
        );
      }
      await expectError(
        command(ctx, 'updateStoreProfile', { storeId: STORE_X, patch: { acceptingOrders: false } }),
        'unauthenticated',
      );
      // Name, status, address and radius are ops-only: they are not in the patch at all.
      await expectError(
        ownerX.call('updateStoreProfile', { storeId: STORE_X, patch: { name: 'Mine now' } }),
        'invalid-argument',
      );
      await expectError(
        ownerX.call('updateStoreProfile', {
          storeId: STORE_X,
          patch: { fulfilment: { deliveryRadiusKm: 60 } },
        }),
        'invalid-argument',
      );
    });

    test('private settings: staff and the owner of the store; store staff, other stores and customers denied', async () => {
      await expectOk(ownerX.get(`/stores/${STORE_X}/settings`));
      await expectOk(dispatcher.get(`/stores/${STORE_X}/settings`));
      await expectOk(admin.get(`/stores/${STORE_X}/settings`));
      await expectError(get(ctx, `/stores/${STORE_X}/settings`), 'unauthenticated');
      for (const actor of [staffX, supplierY, customerA, driver, pendingDriver]) {
        await expectError(actor.get(`/stores/${STORE_X}/settings`), 'permission-denied');
      }
      const store = await expectOk(get<Record<string, unknown>>(ctx, `/stores/${STORE_X}`));
      for (const key of [
        'settings',
        'commissionBps',
        'payoutAccount',
        'loadingNotes',
        'alertPhone',
        'notes',
      ]) {
        assert.ok(!(key in store), `GET /stores/{id} leaks ${key}`);
      }
    });
  });

  describe('store reviews', () => {
    let delivered: string;
    let accepted: string;
    let otherStore: string;

    before(async () => {
      delivered = await insertStoreOrder(ctx, customerA.uid, STORE_X, 'delivered');
      accepted = await insertStoreOrder(ctx, customerA.uid, STORE_X, 'accepted');
      otherStore = await insertStoreOrder(ctx, customerA.uid, STORE_Y, 'picked_up');
    });

    test('a review needs the customer’s own completed store order of that store', async () => {
      const body = { rating: 5, text: 'Great.' };
      await expectError(put(ctx, `/stores/${STORE_X}/reviews/${delivered}`, body), 'unauthenticated');
      await expectError(customerB.put(`/stores/${STORE_X}/reviews/${delivered}`, body), 'permission-denied');
      for (const actor of [ownerX, staffX, driver, dispatcher, admin]) {
        await expectError(actor.put(`/stores/${STORE_X}/reviews/${delivered}`, body), 'permission-denied');
      }
      await expectError(customerA.put(`/stores/${STORE_X}/reviews/${accepted}`, body), 'failed-precondition');
      await expectError(customerA.put(`/stores/${STORE_X}/reviews/${otherStore}`, body), 'permission-denied');
      await expectError(customerA.put(`/stores/${STORE_X}/reviews/${randomUUID()}-A`, body), 'not-found');
      await expectError(
        customerA.put(`/stores/${STORE_X}/reviews/${delivered}`, { rating: 6, text: '' }),
        'invalid-argument',
      );
      await expectError(
        customerA.put(`/stores/${STORE_X}/reviews/${delivered}`, { rating: 4.5, text: '' }),
        'invalid-argument',
      );
      await expectError(
        customerA.put(`/stores/${STORE_X}/reviews/${delivered}`, { rating: 5, text: 'x'.repeat(1001) }),
        'invalid-argument',
      );
      // authorName and customerId are derived by the server; a client cannot set them.
      await expectError(
        customerA.put(`/stores/${STORE_X}/reviews/${delivered}`, { ...body, authorName: 'Someone else' }),
        'invalid-argument',
      );
      await expectError(
        customerA.put(`/stores/${STORE_X}/reviews/${delivered}`, { ...body, customerId: customerB.uid }),
        'invalid-argument',
      );
      const review = await expectOk(
        customerA.put<{ authorName: string; customerId: string }>(
          `/stores/${STORE_X}/reviews/${delivered}`,
          body,
        ),
      );
      assert.equal(review.authorName, 'Ana A.');
      assert.equal(review.customerId, customerA.uid);
      await expectOk(get(ctx, `/stores/${STORE_X}/reviews`));
      await expectOk(get(ctx, `/stores/${STORE_X}/reviews/${delivered}`));
    });

    test('the author and staff delete a review; nobody else', async () => {
      await expectError(del(ctx, `/stores/${STORE_X}/reviews/${delivered}`), 'unauthenticated');
      for (const actor of [customerB, ownerX, staffX, driver]) {
        await expectError(actor.del(`/stores/${STORE_X}/reviews/${delivered}`), 'permission-denied');
      }
      await expectOk(customerA.del(`/stores/${STORE_X}/reviews/${delivered}`), 204);
      await expectOk(customerA.put(`/stores/${STORE_X}/reviews/${delivered}`, { rating: 3, text: '' }));
      await expectOk(dispatcher.del(`/stores/${STORE_X}/reviews/${delivered}`), 204);
    });
  });

  describe('products', () => {
    test('anyone reads listed products and any product by id; the store catalogue is staff and members only', async () => {
      await expectOk(get(ctx, '/products?listed=true'));
      await expectOk(get(ctx, `/products/${productX}`));
      await expectOk(get(ctx, `/products?ids=${productX}`));
      await expectError(get(ctx, `/products?storeId=${STORE_X}`), 'unauthenticated');
      for (const actor of [customerA, driver]) {
        await expectError(actor.get(`/products?storeId=${STORE_X}`), 'permission-denied');
      }
      await expectError(supplierY.get(`/products?storeId=${STORE_X}`), 'permission-denied');
      const own = await expectOk(staffX.get<Page<Product>>('/products'));
      assert.ok(own.items.length > 0 && own.items.every((item) => item.storeId === STORE_X));
      await expectOk(dispatcher.get(`/products?storeId=${STORE_Y}`));
      await expectOk(dispatcher.get('/products?lowStock=true'));
    });

    test('a supplier creates products of their own store only, without staff fields', async () => {
      await expectError(
        put(ctx, `/products/${idFor(STORE_X, 'A-1')}`, productBody('A-1')),
        'unauthenticated',
      );
      for (const actor of [customerA, driver, pendingDriver, supplierY]) {
        await expectError(
          actor.put(`/products/${idFor(STORE_X, 'A-1')}`, productBody('A-1')),
          'permission-denied',
        );
      }
      for (const field of [{ featured: true }, { badge: 'deal' }, { familyKey: 'spf-2x4x8' }]) {
        await expectError(
          ownerX.put(`/products/${idFor(STORE_X, 'A-1')}`, productBody('A-1', field)),
          'permission-denied',
        );
      }
      // Server-only keys and unknown keys are refused by the strict schema.
      for (const field of [
        { reserved: 0 },
        { listed: true },
        { storeId: STORE_X },
        { imageUrl: 'https://example.com/a.png' },
        { searchTerms: ['spf'] },
        { storeName: 'X' },
        { updatedBy: 'me' },
        { colour: 'red' },
      ]) {
        await expectError(
          ownerX.put(`/products/${idFor(STORE_X, 'A-1')}`, productBody('A-1', field)),
          'invalid-argument',
        );
      }
      await expectError(
        ownerX.put(
          `/products/${idFor(STORE_X, 'A-1')}`,
          productBody('A-1', { imagePath: `productPhotos/${STORE_Y}/a.png` }),
        ),
        'invalid-argument',
      );
      await expectError(
        ownerX.put(
          `/products/${idFor(STORE_X, 'A-1')}`,
          productBody('A-1', { imagePath: `productPhotos/${STORE_X}/never-uploaded.png` }),
        ),
        'invalid-argument',
      );
      await expectError(
        ownerX.put(`/products/${idFor(STORE_X, 'A-1')}`, productBody('A-1', { priceCents: 0 })),
        'invalid-argument',
      );
      const product = await expectOk(
        staffX.put<Product>(
          `/products/${idFor(STORE_X, 'A-1')}`,
          productBody('A-1', { featured: false, badge: null, familyKey: null }),
        ),
      );
      assert.equal(product.reserved, 0);
      assert.equal(product.updatedBy, staffX.uid);
      await expectOk(
        dispatcher.put(
          `/products/${idFor(STORE_X, 'A-2')}`,
          productBody('A-2', { featured: true, badge: 'new' }),
        ),
      );
    });

    test('a supplier updates only allowed fields of their own store’s products', async () => {
      for (const actor of [customerA, driver, supplierY]) {
        await expectError(actor.patch(`/products/${productX}`, { priceCents: 999 }), 'permission-denied');
      }
      await expectError(patch(ctx, `/products/${productX}`, { priceCents: 999 }), 'unauthenticated');
      await expectOk(staffX.patch(`/products/${productX}`, { priceCents: 999, stockOnHand: 12 }));
      for (const field of [{ featured: true }, { badge: 'bestseller' }, { familyKey: 'family' }]) {
        await expectError(ownerX.patch(`/products/${productX}`, field), 'permission-denied');
      }
      // Sending the stored value of a staff field is not a change, so it is allowed.
      await expectOk(
        ownerX.patch(`/products/${productX}`, { featured: false, badge: null, familyKey: null }),
      );
      for (const field of [
        { sku: 'X-2' },
        { storeId: STORE_Y },
        { reserved: 0 },
        { listed: false },
        { imageUrl: null },
        { searchTerms: [] },
        { createdAt: 1 },
        { unknown: 1 },
      ]) {
        await expectError(ownerX.patch(`/products/${productX}`, field), 'invalid-argument');
      }
      await expectError(
        ownerX.patch(`/products/${productX}`, { imagePath: `productPhotos/${STORE_Y}/a.png` }),
        'invalid-argument',
      );
      const featured = await expectOk(
        dispatcher.patch<Product>(`/products/${productX}`, { featured: true, familyKey: 'stud-family' }),
      );
      assert.equal(featured.featured, true);
      await expectError(ownerX.patch(`/products/${productX}`, { featured: false }), 'permission-denied');
    });

    test('stock-adjust: staff and members of the product’s store', async () => {
      await expectOk(staffX.post(`/products/${productX}/stock-adjust`, { delta: 5 }));
      await expectOk(admin.post(`/products/${productX}/stock-adjust`, { delta: -1 }));
      for (const actor of [customerA, driver, supplierY]) {
        await expectError(
          actor.post(`/products/${productX}/stock-adjust`, { delta: 5 }),
          'permission-denied',
        );
      }
      await expectError(post(ctx, `/products/${productX}/stock-adjust`, { delta: 5 }), 'unauthenticated');
      await expectError(
        staffX.post(`/products/${productX}/stock-adjust`, { delta: 5, reserved: 0 }),
        'invalid-argument',
      );
    });

    test('delete: the owner of the store or an admin, only with reserved = 0', async () => {
      const ownerTarget = (await createProduct(ctx, STORE_X, { sku: 'X-DEL1' })).id;
      const adminTarget = (await createProduct(ctx, STORE_X, { sku: 'X-DEL2' })).id;
      for (const actor of [staffX, supplierY, customerA, driver, dispatcher]) {
        await expectError(actor.del(`/products/${ownerTarget}`), 'permission-denied');
      }
      await expectError(del(ctx, `/products/${ownerTarget}`), 'unauthenticated');
      await expectError(ownerX.del(`/products/${heldX}`), 'failed-precondition');
      await expectError(admin.del(`/products/${heldX}`), 'failed-precondition');
      await expectOk(ownerX.del(`/products/${ownerTarget}`), 204);
      await expectOk(admin.del(`/products/${adminTarget}`), 204);
      await expectError(admin.del(`/products/${adminTarget}`), 'not-found');
    });
  });

  test('a suspended supplier is refused everywhere', async () => {
    const suspended = await newSupplier(ctx, { storeId: STORE_X, storeRole: 'owner' });
    await ctx.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [suspended.uid]);
    await expectError(suspended.patch(`/products/${productX}`, { priceCents: 1 }), 403);
    await expectError(suspended.get(`/stores/${STORE_X}/settings`), 403);
    await expectError(
      suspended.call('updateStoreProfile', { storeId: STORE_X, patch: { acceptingOrders: false } }),
      403,
    );
  });
});
