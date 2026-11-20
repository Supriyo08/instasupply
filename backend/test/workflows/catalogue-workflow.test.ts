/**
 * Catalogue workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3): product derivation (`search_terms`, `listed`,
 * the store copies, `imageUrl`), the store fan-out of name and status, category edits that recompute search
 * terms, the store rating from reviews, and the concurrency of these writers on real row locks.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  Category,
  Page,
  Product,
  Store,
  StorePrivateSettings,
  StoreReview,
  WithId,
} from '@instasupply/shared';
import { as, newAdmin, newCustomer, newDispatcher, newSupplier, type ActorClient } from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { createProduct, createStore } from '../support/fixtures';
import { expectError, expectOk, get } from '../support/http';
import { race, together } from '../support/race';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(48, 3),
]);

/** A product body as the portal sends it (PUT /products/{id}). */
function productBody(sku: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sku,
    name: 'CGC Sheetrock UltraLight 1/2 in 4×8',
    brand: 'CGC',
    categoryId: 'drywall',
    unit: 'sheet',
    size: '1/2 in × 4 ft × 8 ft',
    description: 'Lightweight gypsum board.',
    priceCents: 1899,
    compareAtCents: null,
    stockOnHand: 40,
    maxPerOrder: null,
    weightKg: 22.7,
    dimsCm: { l: 244, w: 122, h: 1.3 },
    shipEstimated: false,
    active: true,
    imageKey: null,
    imagePath: null,
    ...overrides,
  };
}

const productId = (storeId: string, sku: string) =>
  `${storeId}--${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** An order and one completed store order of `customerId` at `storeId`, written with SQL (§3.2 shapes). */
async function insertStoreOrder(
  ctx: TestContext,
  input: { customerId: string; storeId: string; status?: string; fulfilment?: 'delivery' | 'pickup' },
): Promise<string> {
  const orderId = randomUUID();
  const { rows } = await ctx.pool.query<{ n: string }>("SELECT nextval('order_number_seq')::text AS n");
  const number = `IS-${rows[0]!.n}`;
  const now = ctx.clock.now();
  await ctx.pool.query(
    `INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
    [
      orderId,
      JSON.stringify({
        number,
        customerId: input.customerId,
        source: 'cart',
        status: 'completed',
        needsAttention: false,
        payment: { status: 'captured', captureDeadlineAt: null },
        current: { totalCents: 10000 },
      }),
      new Date(now),
    ],
  );
  const storeOrderId = `${orderId}-A`;
  await ctx.pool.query(
    `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, '{}'::jsonb, $3, $3)`,
    [
      storeOrderId,
      JSON.stringify({
        orderId,
        storeId: input.storeId,
        customerId: input.customerId,
        number: `${number}-A`,
        letter: 'A',
        status: input.status ?? 'delivered',
        fulfilment: input.fulfilment ?? 'delivery',
        version: 7,
        deliveryId: null,
        timing: { respondBy: now, readyBy: now, readyByDate: '2026-11-19' },
        acceptOverdue: false,
        reminderSentAt: null,
        completedAt: now,
        rated: false,
      }),
      new Date(now),
    ],
  );
  return storeOrderId;
}

function multipart(fields: Record<string, string>, file: Buffer, contentType: string) {
  const boundary = '----catalogue-test-boundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** presign → upload through the local driver → confirm; returns the confirmed path. */
async function uploadPhoto(
  ctx: TestContext,
  actor: ActorClient,
  purpose: 'product_photo' | 'store_photo',
  storeId: string,
): Promise<string> {
  const ticket = await expectOk(
    actor.post<{ uploadId: string; path: string; url: string; fields: Record<string, string> }>(
      '/files/presign',
      {
        purpose,
        ownerId: storeId,
        fileName: 'photo.png',
        contentType: 'image/png',
        sizeBytes: PNG.length,
      },
    ),
  );
  const form = multipart(ticket.fields, PNG, 'image/png');
  const uploaded = await ctx.app.inject({ method: 'POST', url: new URL(ticket.url).pathname, ...form });
  assert.equal(uploaded.statusCode, 204, uploaded.body);
  await expectOk(actor.post('/files/confirm', { uploadId: ticket.uploadId }));
  return ticket.path;
}

async function productRow(ctx: TestContext, id: string) {
  const { rows } = await ctx.pool.query<{
    search_terms: string[];
    listed: boolean;
    store_name: string;
    store_status: string;
    stock_on_hand: number;
    reserved: number;
  }>(
    'SELECT search_terms, listed, store_name, store_status, stock_on_hand, reserved FROM products WHERE id = $1',
    [id],
  );
  return rows[0];
}

describe('catalogue workflow (§12.4 catalogue-workflow.test.ts)', () => {
  let ctx: TestContext;
  let admin: ActorClient;
  let dispatcher: ActorClient;

  before(async () => {
    ctx = await createTestContext();
    admin = await newAdmin(ctx);
    dispatcher = await newDispatcher(ctx);
  });
  after(() => ctx.close());

  describe('product derivation (the old onProductWritten)', () => {
    test('a created product gets search terms, store copies, listed and reserved = 0 from the server', async () => {
      const owner = await newSupplier(ctx, { store: { name: 'Drywall Depot' } });
      const id = productId(owner.storeId, 'DD-SR12');
      const product = await expectOk(
        owner.put<Product>(`/products/${id}`, productBody('DD-SR12', { familyKey: null })),
      );
      assert.equal(product.id, id);
      assert.equal(product.storeId, owner.storeId);
      assert.equal(product.storeName, 'Drywall Depot');
      assert.equal(product.storeStatus, 'live');
      assert.equal(product.listed, true);
      assert.equal(product.reserved, 0);
      assert.equal(product.stockOnHand, 40);
      assert.equal(product.updatedBy, owner.uid);
      assert.equal(product.imageUrl, null);
      // name, brand, SKU, size, the category name and its synonyms (MARKETPLACE §1.5: drywall → sheetrock, gyprock)
      for (const key of [
        'cgc',
        'sheetrock',
        'ultralight',
        'dd',
        'sr12',
        'drywall',
        'gyprock',
        'gypsum',
        'mud',
        '1/2',
      ])
        assert.ok(product.searchTerms.includes(key), `searchTerms has ${key}`);
      assert.deepEqual((await productRow(ctx, id))?.search_terms, product.searchTerms);

      const found = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=gyprock'));
      assert.deepEqual(
        found.items.map((item) => item.id),
        [id],
      );
      const bySku = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=DD-SR12'));
      assert.deepEqual(
        bySku.items.map((item) => item.id),
        [id],
      );
      // A search of words: every key must match.
      const none = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=gyprock%20romex'));
      assert.equal(none.items.length, 0);
      // Too short to search: an empty page, not an error.
      const short = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=a'));
      assert.deepEqual(short, { items: [], nextCursor: null });
    });

    test('listed follows active and the store status; staff set the family key and it is searchable', async () => {
      const store = await createStore(ctx, { name: 'Coming Lumber', status: 'coming_soon' });
      const id = productId(store.id, 'CL-1');
      const created = await expectOk(
        dispatcher.put<Product>(
          `/products/${id}`,
          productBody('CL-1', { categoryId: 'wood', familyKey: 'spf-2x4x8', featured: true, badge: 'deal' }),
        ),
      );
      assert.equal(created.listed, false, 'a store that is not live lists nothing');
      assert.equal(created.featured, true);
      assert.equal(created.badge, 'deal');
      assert.ok(created.searchTerms.includes('2x4x8'), 'the family key is searchable');

      const owner = await newSupplier(ctx, { store: { name: 'Live Lumber' } });
      const liveId = productId(owner.storeId, 'LL-1');
      const inactive = await expectOk(
        owner.put<Product>(`/products/${liveId}`, productBody('LL-1', { active: false })),
      );
      assert.equal(inactive.listed, false);
      const listedBefore = await expectOk(
        get<Page<Product>>(ctx, `/products?listed=true&storeId=${owner.storeId}`),
      );
      assert.equal(listedBefore.items.length, 0);
      const portal = await expectOk(
        owner.get<Page<Product>>(`/products?storeId=${owner.storeId}&active=false`),
      );
      assert.deepEqual(
        portal.items.map((item) => item.id),
        [liveId],
      );
      const active = await expectOk(owner.patch<Product>(`/products/${liveId}`, { active: true }));
      assert.equal(active.listed, true);
      assert.equal((await productRow(ctx, liveId))?.listed, true);
    });

    test('a PATCH recomputes search terms from the merged product; sku and store never change', async () => {
      const owner = await newSupplier(ctx);
      const id = productId(owner.storeId, 'PX-9');
      await expectOk(owner.put(`/products/${id}`, productBody('PX-9')));
      const renamed = await expectOk(
        owner.patch<Product>(`/products/${id}`, { name: 'Romex NMD90 14/2 cable', categoryId: 'electrical' }),
      );
      assert.ok(renamed.searchTerms.includes('romex'));
      assert.ok(renamed.searchTerms.includes('wire'), 'electrical synonym');
      assert.ok(!renamed.searchTerms.includes('gyprock'), 'old category synonyms are gone');
      assert.equal(renamed.sku, 'PX-9');
      await expectError(owner.patch(`/products/${id}`, { sku: 'OTHER' }), 'invalid-argument');
    });

    test('weight and size left out come from the category defaults with shipEstimated', async () => {
      const owner = await newSupplier(ctx);
      const id = productId(owner.storeId, 'EST-1');
      const body = productBody('EST-1', { categoryId: 'masonry' });
      delete body.weightKg;
      delete body.dimsCm;
      // The strict schema needs every key: the portal sends the category defaults itself, flagged estimated.
      await expectError(owner.put(`/products/${id}`, body), 'invalid-argument');
      const product = await expectOk(
        owner.put<Product>(
          `/products/${id}`,
          productBody('EST-1', {
            categoryId: 'masonry',
            shipEstimated: true,
            dimsCm: { l: 12, w: 60, h: 40 },
          }),
        ),
      );
      assert.equal(product.shipEstimated, true);
      assert.deepEqual(product.dimsCm, { l: 60, w: 40, h: 12 }, 'sides are stored longest first');
      const estimated = await expectOk(
        owner.get<Page<Product>>(`/products?storeId=${owner.storeId}&estimated=true`),
      );
      assert.deepEqual(
        estimated.items.map((item) => item.id),
        [id],
      );
    });

    test('a confirmed product photo becomes imageUrl; a foreign or unconfirmed path is refused', async () => {
      const owner = await newSupplier(ctx);
      const other = await newSupplier(ctx);
      const id = productId(owner.storeId, 'PH-1');
      await expectOk(owner.put(`/products/${id}`, productBody('PH-1')));
      const path = await uploadPhoto(ctx, owner, 'product_photo', owner.storeId);
      const withPhoto = await expectOk(owner.patch<Product>(`/products/${id}`, { imagePath: path }));
      assert.equal(withPhoto.imagePath, path);
      assert.ok(withPhoto.imageUrl?.endsWith(`/api/v1/media/${path}`), withPhoto.imageUrl ?? 'null');
      const foreign = await uploadPhoto(ctx, other, 'product_photo', other.storeId);
      await expectError(owner.patch(`/products/${id}`, { imagePath: foreign }), 'invalid-argument');
      await expectError(
        owner.patch(`/products/${id}`, { imagePath: `productPhotos/${owner.storeId}/never-uploaded.png` }),
        'invalid-argument',
      );
      const cleared = await expectOk(owner.patch<Product>(`/products/${id}`, { imagePath: null }));
      assert.equal(cleared.imageUrl, null);
    });

    test('stock-adjust is one clamped statement; delete needs reserved = 0', async () => {
      const owner = await newSupplier(ctx);
      const fixture = await createProduct(ctx, owner.storeId, { stockOnHand: 5, reserved: 0 });
      const lower = await expectOk(
        owner.post<Product>(`/products/${fixture.id}/stock-adjust`, { delta: -50 }),
      );
      assert.equal(lower.stockOnHand, 0, 'clamped at 0');
      const higher = await expectOk(
        owner.post<Product>(`/products/${fixture.id}/stock-adjust`, { delta: 1_000_000 }),
      );
      assert.equal(higher.stockOnHand, 1_000_000, 'clamped at 1 000 000');
      await expectError(owner.post(`/products/${fixture.id}/stock-adjust`, { delta: 0 }), 'invalid-argument');
      await expectError(
        owner.post(`/products/${fixture.id}/stock-adjust`, { delta: 1.5 }),
        'invalid-argument',
      );

      const held = await createProduct(ctx, owner.storeId, { stockOnHand: 10, reserved: 3 });
      await expectError(owner.del(`/products/${held.id}`), 'failed-precondition');
      await expectOk(owner.del(`/products/${fixture.id}`), 204);
      await expectError(get(ctx, `/products/${fixture.id}`), 'not-found');
    });

    test('concurrent stock adjustments all count', async () => {
      const owner = await newSupplier(ctx);
      const fixture = await createProduct(ctx, owner.storeId, { stockOnHand: 100 });
      const answers = await together(
        Array.from(
          { length: 12 },
          (_, index) => () =>
            owner.post(`/products/${fixture.id}/stock-adjust`, { delta: index % 2 === 0 ? 3 : -1 }),
        ),
      );
      for (const answer of answers) assert.equal(answer.status, 200, JSON.stringify(answer.body));
      assert.equal((await productRow(ctx, fixture.id))?.stock_on_hand, 100 + 6 * 3 - 6);
    });

    test('an existing product id is already-exists; the id must match the store and the SKU', async () => {
      const owner = await newSupplier(ctx);
      const id = productId(owner.storeId, 'DUP-1');
      await expectOk(owner.put(`/products/${id}`, productBody('DUP-1')));
      await expectError(owner.put(`/products/${id}`, productBody('DUP-1')), 'already-exists');
      await expectError(owner.put(`/products/${id}x`, productBody('DUP-1')), 'invalid-argument');
      await expectError(owner.put(`/products/no-separator`, productBody('DUP-1')), 'invalid-argument');
    });
  });

  describe('store fan-out (the old onStoreWritten)', () => {
    test('a rename and a status change reach every product of the store in the same transaction', async () => {
      const store = await createStore(ctx, { name: 'Fanout Supply' });
      const products = await Promise.all([1, 2, 3].map(() => createProduct(ctx, store.id)));
      const untouched = await createStore(ctx, { name: 'Bystander' });
      const bystander = await createProduct(ctx, untouched.id);

      await expectOk(
        admin.call('updateStoreSettings', {
          storeId: store.id,
          store: { name: 'Fanout Supply Co.', status: 'closed' },
        }),
      );
      for (const product of products) {
        const row = await productRow(ctx, product.id);
        assert.equal(row?.store_name, 'Fanout Supply Co.');
        assert.equal(row?.store_status, 'closed');
        assert.equal(row?.listed, false);
      }
      assert.equal((await productRow(ctx, bystander.id))?.store_name, 'Bystander');
      const listed = await expectOk(get<Page<Product>>(ctx, `/products?listed=true&storeId=${store.id}`));
      assert.equal(listed.items.length, 0);

      await expectOk(admin.call('updateStoreSettings', { storeId: store.id, store: { status: 'live' } }));
      for (const product of products) assert.equal((await productRow(ctx, product.id))?.listed, true);
      const storeDoc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(storeDoc.name, 'Fanout Supply Co.');
      assert.equal(storeDoc.status, 'live');
    });

    test('updateStoreSettings merges the radius into fulfilment and validates the merged store', async () => {
      const store = await createStore(ctx);
      await expectOk(
        admin.call('updateStoreSettings', {
          storeId: store.id,
          store: { deliveryRadiusKm: 30 },
          settings: { commissionBps: 1200, alertPhone: '(416) 555-0199' },
        }),
      );
      const doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(doc.fulfilment.deliveryRadiusKm, 30);
      assert.equal(doc.fulfilment.delivery, true);
      const settings = await expectOk(admin.get<StorePrivateSettings>(`/stores/${store.id}/settings`));
      assert.equal(settings.commissionBps, 1200);
      assert.equal(settings.alertPhone, '+14165550199');
      await expectError(
        admin.call('updateStoreSettings', { storeId: store.id, store: { deliveryRadiusKm: 61 } }),
        'invalid-argument',
      );
      await expectError(
        admin.call('updateStoreSettings', { storeId: store.id, settings: { commissionBps: 3001 } }),
        'invalid-argument',
      );
      await expectError(
        admin.call('updateStoreSettings', { storeId: 'no-such-store', store: {} }),
        'not-found',
      );
    });

    test('concurrent product edits and a store rename never leave a stale store name', async () => {
      await race({
        times: 10,
        setup: async (round) => {
          const store = await createStore(ctx, { name: `Race Store ${round}` });
          const owner = await newSupplier(ctx, { storeId: store.id });
          const product = await createProduct(ctx, store.id);
          return { store, owner, product };
        },
        run: ({ store, owner, product }, round) => [
          () => admin.call('updateStoreSettings', { storeId: store.id, store: { name: `Renamed ${round}` } }),
          () => owner.patch(`/products/${product.id}`, { priceCents: 1234 }),
          () => owner.patch(`/products/${product.id}`, { name: 'Edited name' }),
        ],
        check: async (answers, { product }, round) => {
          for (const answer of answers) assert.equal(answer.status, 200, JSON.stringify(answer.body));
          const row = await productRow(ctx, product.id);
          assert.equal(row?.store_name, `Renamed ${round}`);
        },
      });
    });

    test('createStore writes the store and its private settings; a taken slug is already-exists', async () => {
      const request = {
        storeId: 'harbour-glass',
        store: {
          name: 'Harbour Glass & Mirror',
          specialty: 'glass_mirrors',
          categoryIds: ['glass', 'windows'],
          description: 'Cut glass and mirrors.',
          marketId: 'gta',
          cityId: 'toronto',
          areaLabel: 'Liberty Village',
          address: {
            line1: '10 Atlantic Ave',
            line2: null,
            city: 'Toronto',
            province: 'ON',
            postalCode: 'm6k 3e7',
          },
          location: { lat: 43.6389, lng: -79.4197 },
          phone: '416-555-0177',
          email: null,
          photoUrl: null,
          imageKey: null,
          hours: {
            mon: { open: '08:00', close: '17:00' },
            tue: { open: '08:00', close: '17:00' },
            wed: { open: '08:00', close: '17:00' },
            thu: { open: '08:00', close: '17:00' },
            fri: { open: '08:00', close: '17:00' },
            sat: null,
            sun: null,
          },
          closures: [],
          fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: 25 },
          prepMinutes: 45,
          sameDayCutoff: '14:00',
          status: 'onboarding',
          acceptingOrders: false,
        },
        settings: {
          commissionBps: 1000,
          payoutAccount: null,
          ordersEmail: 'Orders@Harbour.example',
          alertPhone: null,
          loadingNotes: 'Dock at the rear.',
          onboarding: { catalogReady: false, payoutsReady: false, trained: false },
          notes: null,
        },
      };
      await expectOk(admin.call('createStore', request));
      const store = await expectOk(get<Store>(ctx, '/stores/harbour-glass'));
      assert.equal(store.phone, '+14165550177', 'the cleaned value of validateStore is stored');
      assert.equal(store.address.postalCode, 'M6K 3E7');
      assert.equal(store.rating, 0);
      assert.equal(store.ratingCount, 0);
      assert.equal(store.photoUrl, null);
      assert.ok(!('photoPath' in store));
      const settings = await expectOk(admin.get<StorePrivateSettings>('/stores/harbour-glass/settings'));
      assert.equal(settings.ordersEmail, 'orders@harbour.example');
      assert.equal(settings.loadingNotes, 'Dock at the rear.');
      assert.ok(
        !('settings' in store) && !('loadingNotes' in store),
        'settings never leave through GET /stores',
      );
      await expectError(admin.call('createStore', request), 'already-exists');
      await expectError(admin.call('createStore', { ...request, storeId: 'bad--id' }), 'invalid-argument');
      await expectError(
        admin.call('createStore', {
          ...request,
          storeId: 'other-glass',
          store: { ...request.store, phone: '12' },
        }),
        'invalid-argument',
      );
      const list = await expectOk(get<Page<Store>>(ctx, '/stores?marketId=gta&status=onboarding'));
      assert.ok(list.items.some((item) => item.id === 'harbour-glass'));
      assert.ok(list.items.every((item) => item.status === 'onboarding'));
    });

    test('updateStoreProfile: hours, photo and private fields; pausing notifies staff, the store stays listed', async () => {
      const owner = await newSupplier(ctx, { store: { name: 'Pause Hardware' } });
      const product = await createProduct(ctx, owner.storeId);
      const photo = await uploadPhoto(ctx, owner, 'store_photo', owner.storeId);
      await expectOk(
        owner.call('updateStoreProfile', {
          storeId: owner.storeId,
          patch: {
            description: 'Fasteners and more.',
            prepMinutes: 30,
            photoPath: photo,
            loadingNotes: 'Gate code 4411',
            alertPhone: '647 555 0123',
            fulfilment: { pickup: false },
          },
        }),
      );
      const store = await expectOk(get<Store>(ctx, `/stores/${owner.storeId}`));
      assert.equal(store.description, 'Fasteners and more.');
      assert.equal(store.prepMinutes, 30);
      assert.equal(store.fulfilment.pickup, false);
      assert.equal(store.fulfilment.delivery, true);
      assert.ok(store.photoUrl?.endsWith(`/api/v1/media/${photo}`));
      assert.ok(!JSON.stringify(store).includes('4411'), 'loading notes are private');
      const settings = await expectOk(owner.get<StorePrivateSettings>(`/stores/${owner.storeId}/settings`));
      assert.equal(settings.loadingNotes, 'Gate code 4411');
      assert.equal(settings.alertPhone, '+16475550123');

      await expectOk(
        owner.call('updateStoreProfile', { storeId: owner.storeId, patch: { acceptingOrders: false } }),
      );
      const { rows } = await ctx.pool.query<{ user_id: string; type: string; dedupe_key: string }>(
        `SELECT user_id, type, dedupe_key FROM notifications WHERE dedupe_key LIKE $1 ORDER BY user_id`,
        [`store-paused-${owner.storeId}-%`],
      );
      assert.deepEqual(new Set(rows.map((row) => row.user_id)), new Set([admin.uid, dispatcher.uid]));
      assert.ok(rows.every((row) => row.type === 'system'));
      assert.equal((await productRow(ctx, product.id))?.listed, true, 'a paused store stays listed');
      const paused = await expectOk(get<Store>(ctx, `/stores/${owner.storeId}`));
      assert.equal(paused.acceptingOrders, false);

      // Closures in the past and a bad cut-off are refused by validateStoreProfile.
      await expectError(
        owner.call('updateStoreProfile', { storeId: owner.storeId, patch: { closures: ['2026-11-01'] } }),
        'invalid-argument',
      );
      await expectError(
        owner.call('updateStoreProfile', { storeId: owner.storeId, patch: { sameDayCutoff: '25:00' } }),
        'invalid-argument',
      );
      const otherPhoto = await uploadPhoto(ctx, admin, 'store_photo', 'harbour-glass');
      await expectError(
        owner.call('updateStoreProfile', { storeId: owner.storeId, patch: { photoPath: otherPhoto } }),
        'invalid-argument',
      );
    });
  });

  describe('category edits recompute search terms', () => {
    test('a new synonym makes every product of the category findable by it', async () => {
      const store = await createStore(ctx);
      const a = await createProduct(ctx, store.id, {
        categoryId: 'insulation',
        name: 'Roxul Comfortboard 80',
      });
      const b = await createProduct(ctx, store.id, { categoryId: 'insulation', name: 'Pink batts R20' });
      const other = await createProduct(ctx, store.id, { categoryId: 'wood', name: 'SPF stud' });
      const before = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=acoustical'));
      assert.equal(before.items.length, 0);

      const current = (await expectOk(get<Page<Category>>(ctx, '/categories?limit=500'))).items.find(
        (item) => item.id === 'insulation',
      )!;
      const updated = await expectOk(
        dispatcher.patch<Category>('/categories/insulation', {
          synonyms: [...current.synonyms, 'acoustical'],
        }),
      );
      assert.ok(updated.synonyms.includes('acoustical'));
      const after = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=acoustical'));
      assert.deepEqual(after.items.map((item) => item.id).sort(), [a.id, b.id].sort());
      assert.ok(!(await productRow(ctx, other.id))?.search_terms.includes('acoustical'));

      // A rename is searchable too; a PUT replaces the whole document.
      await expectOk(
        dispatcher.put<Category>('/categories/insulation', {
          ...updated,
          name: 'Thermal Wrap',
          id: undefined,
        }),
      );
      const renamed = await expectOk(get<Page<Product>>(ctx, '/products?listed=true&q=thermal'));
      assert.deepEqual(renamed.items.map((item) => item.id).sort(), [a.id, b.id].sort());
    });

    test('reorder rewrites sortOrder 1…n; delete refuses a category in use', async () => {
      const all = (await expectOk(get<Page<Category>>(ctx, '/categories?limit=500'))).items;
      assert.equal(all.length, 25);
      const ids = all.map((item) => item.id).reverse();
      await expectOk(dispatcher.post('/categories/reorder', { ids }), 204);
      const reordered = (await expectOk(get<Page<Category>>(ctx, '/categories?limit=500'))).items;
      assert.deepEqual(
        reordered.map((item) => item.id),
        ids,
      );
      assert.deepEqual(
        reordered.map((item) => item.sortOrder),
        ids.map((_, index) => index + 1),
      );
      await expectError(dispatcher.post('/categories/reorder', { ids: ids.slice(1) }), 'invalid-argument');
      await expectError(
        dispatcher.post('/categories/reorder', { ids: [...ids.slice(1), ids[1]] }),
        'invalid-argument',
      );

      // Paged by sortOrder: two pages without a gap or a repeat.
      const first = await expectOk(get<Page<Category>>(ctx, '/categories?limit=20'));
      assert.ok(first.nextCursor);
      const second = await expectOk(
        get<Page<Category>>(ctx, `/categories?limit=20&cursor=${first.nextCursor}`),
      );
      assert.deepEqual(
        [...first.items, ...second.items].map((item) => item.id),
        ids,
      );

      const store = await createStore(ctx);
      await createProduct(ctx, store.id, { categoryId: 'kitchen' });
      await expectError(admin.del('/categories/kitchen'), 'failed-precondition');
      await expectOk(admin.del('/categories/appliances'), 204);
      await expectError(admin.del('/categories/appliances'), 'not-found');
    });
  });

  describe('store rating from reviews (the old onStoreReviewWritten)', () => {
    test('reviews set the rating, the count and the store order flag; edits and deletes recompute', async () => {
      const store = await createStore(ctx, { name: 'Rated Supply' });
      const dana = await newCustomer(ctx, { displayName: 'Dana Whitfield' });
      const sam = await newCustomer(ctx, { displayName: 'Sam' });
      const danaOrder = await insertStoreOrder(ctx, { customerId: dana.uid, storeId: store.id });
      const samOrder = await insertStoreOrder(ctx, {
        customerId: sam.uid,
        storeId: store.id,
        status: 'picked_up',
        fulfilment: 'pickup',
      });

      const review = await expectOk(
        dana.put<WithId<StoreReview>>(`/stores/${store.id}/reviews/${danaOrder}`, {
          rating: 4,
          text: '  On time.  ',
        }),
      );
      assert.equal(review.id, danaOrder);
      assert.equal(review.storeOrderId, danaOrder);
      assert.equal(review.customerId, dana.uid);
      assert.equal(review.authorName, 'Dana W.');
      assert.equal(review.text, 'On time.');
      await expectOk(sam.put(`/stores/${store.id}/reviews/${samOrder}`, { rating: 5, text: '' }));

      let doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(doc.rating, 4.5);
      assert.equal(doc.ratingCount, 2);
      const { rows } = await ctx.pool.query<{ rated: boolean }>(
        `SELECT (doc->>'rated')::boolean AS rated FROM store_orders WHERE id = ANY($1::text[])`,
        [[danaOrder, samOrder]],
      );
      assert.deepEqual(
        rows.map((row) => row.rated),
        [true, true],
      );

      ctx.clock.advance(60_000);
      const edited = await expectOk(
        dana.put<WithId<StoreReview>>(`/stores/${store.id}/reviews/${danaOrder}`, {
          rating: 2,
          text: 'Late.',
        }),
      );
      assert.equal(edited.createdAt, review.createdAt, 'an edit keeps createdAt');
      assert.equal(edited.updatedAt, review.updatedAt + 60_000);
      doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(doc.rating, 3.5);
      const list = await expectOk(get<Page<WithId<StoreReview>>>(ctx, `/stores/${store.id}/reviews`));
      assert.deepEqual(
        list.items.map((item) => item.id),
        [danaOrder, samOrder],
        'newest update first',
      );
      const one = await expectOk(get<WithId<StoreReview>>(ctx, `/stores/${store.id}/reviews/${samOrder}`));
      assert.equal(one.rating, 5);

      await expectOk(sam.del(`/stores/${store.id}/reviews/${samOrder}`), 204);
      doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(doc.rating, 2);
      assert.equal(doc.ratingCount, 1);
      const flag = await ctx.pool.query<{ rated: boolean }>(
        `SELECT (doc->>'rated')::boolean AS rated FROM store_orders WHERE id = $1`,
        [samOrder],
      );
      assert.equal(flag.rows[0]?.rated, false);
      await expectError(get(ctx, `/stores/${store.id}/reviews/${samOrder}`), 'not-found');
      await expectOk(dispatcher.del(`/stores/${store.id}/reviews/${danaOrder}`), 204);
      doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(doc.rating, 0);
      assert.equal(doc.ratingCount, 0);
    });

    test('customers rating one store at the same moment are all counted', async () => {
      await race({
        times: 8,
        setup: async () => {
          const store = await createStore(ctx);
          const customers = await Promise.all([0, 1, 2].map(() => newCustomer(ctx)));
          const orders = [];
          for (const customer of customers)
            orders.push(await insertStoreOrder(ctx, { customerId: customer.uid, storeId: store.id }));
          return { store, customers, orders };
        },
        run: ({ store, customers, orders }) =>
          customers.map(
            (customer, index) => () =>
              customer.put(`/stores/${store.id}/reviews/${orders[index]}`, { rating: index + 3, text: '' }),
          ),
        check: async (answers, { store }) => {
          for (const answer of answers) assert.equal(answer.status, 200, JSON.stringify(answer.body));
          const doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
          assert.equal(doc.ratingCount, 3);
          assert.equal(doc.rating, 4);
        },
      });
    });

    test('the same review sent twice at once leaves one row', async () => {
      const store = await createStore(ctx);
      const customer = await newCustomer(ctx);
      const order = await insertStoreOrder(ctx, { customerId: customer.uid, storeId: store.id });
      const answers = await together(
        [1, 2, 3].map(
          (rating) => () => customer.put(`/stores/${store.id}/reviews/${order}`, { rating, text: '' }),
        ),
      );
      for (const answer of answers) assert.equal(answer.status, 200, JSON.stringify(answer.body));
      const doc = await expectOk(get<Store>(ctx, `/stores/${store.id}`));
      assert.equal(doc.ratingCount, 1);
    });
  });

  describe('product listing', () => {
    test('keyset pages by name neither skip nor repeat; price order within a family', async () => {
      await as(ctx, 'admin'); // seeds the named data set once, so the listing has more than one store
      const store = await createStore(ctx, { name: 'Pager' });
      const names = ['Alpha', 'bravo', 'Charlie', 'delta', 'Echo', 'foxtrot', 'Golf'];
      for (const [index, name] of names.entries()) {
        await createProduct(ctx, store.id, {
          name,
          familyKey: 'pager-family',
          priceCents: 1000 + ((index * 7) % 5) * 100,
        });
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<Product> = await expectOk(
          get<Page<Product>>(
            ctx,
            `/products?listed=true&storeId=${store.id}&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
          ),
        );
        seen.push(...page.items.map((item) => item.name));
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(
        seen,
        [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      );

      const family = await expectOk(
        get<Page<Product>>(ctx, '/products?listed=true&familyKey=pager-family&sort=priceCents:asc&limit=4'),
      );
      const prices = family.items.map((item) => item.priceCents);
      assert.deepEqual(
        prices,
        [...prices].sort((a, b) => a - b),
      );
      assert.ok(family.nextCursor);
      const rest = await expectOk(
        get<Page<Product>>(
          ctx,
          `/products?listed=true&familyKey=pager-family&sort=priceCents:asc&limit=4&cursor=${family.nextCursor}`,
        ),
      );
      assert.equal(family.items.length + rest.items.length, names.length);
      await expectError(get(ctx, '/products?listed=true&sort=priceCents:asc'), 'invalid-argument');
      await expectError(get(ctx, '/products?listed=true&cursor=not-a-cursor'), 'invalid-argument');
      await expectError(get(ctx, '/products?listed=true&lowStock=true'), 'invalid-argument');
    });

    test('ids returns listed and unlisted products; inStock and featured filter the listed catalogue', async () => {
      const store = await createStore(ctx);
      const empty = await createProduct(ctx, store.id, { stockOnHand: 4, reserved: 4 });
      const full = await createProduct(ctx, store.id, { stockOnHand: 9, featured: true });
      const inactive = await createProduct(ctx, store.id, { active: false });
      const byIds = await expectOk(
        get<Page<Product>>(ctx, `/products?ids=${[empty.id, inactive.id, 'missing--x'].join(',')}`),
      );
      assert.deepEqual(byIds.items.map((item) => item.id).sort(), [empty.id, inactive.id].sort());
      const inStock = await expectOk(
        get<Page<Product>>(ctx, `/products?listed=true&storeId=${store.id}&inStock=true`),
      );
      assert.deepEqual(
        inStock.items.map((item) => item.id),
        [full.id],
      );
      const featured = await expectOk(
        get<Page<Product>>(ctx, `/products?listed=true&storeId=${store.id}&featured=true`),
      );
      assert.deepEqual(
        featured.items.map((item) => item.id),
        [full.id],
      );
      const owner = await newSupplier(ctx, { storeId: store.id });
      const low = await expectOk(owner.get<Page<Product>>(`/products?storeId=${store.id}&lowStock=true`));
      assert.deepEqual(
        low.items.map((item) => item.id).sort(),
        [empty.id, full.id].sort(),
        'available below 10',
      );
    });
  });
});
