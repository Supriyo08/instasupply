/**
 * "A supplier of store A never sees store B" (docs/PLATFORM.md §7.4, §12.4): every endpoint, command and live
 * topic of the §7.4 list, called by an active supplier (the owner) of store Y against the objects of store X,
 * answers permission-denied; a request for another store is never an empty list. Each case also runs the
 * owner of store X once where the endpoint belongs to this workstream, to prove the denial is about the store.
 *
 * Several endpoints of the list belong to other wave-2 workstreams (store orders, issues, ledger, support,
 * supplier users). While their owner has not registered the route or the command yet (the route table answers
 * "There is nothing at this address." and stubs answer internal "not implemented"), that case is reported as
 * skipped with the owner's name instead of passing: it turns into a real assertion the moment the route lands.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test, type TestContext as NodeTestContext } from 'node:test';
import { newSupplier, type ActorClient } from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { createProduct, createStore } from '../support/fixtures';
import type { Answer, ErrorBody } from '../support/http';

const STORE_X = 'store-x';
const STORE_Y = 'store-y';
const PNG_SIZE = 64;

/** Asserts permission-denied, or skips the case while the endpoint's owner has not landed it. */
function expectDenied(t: NodeTestContext, answer: Answer<unknown>, owner: string): void {
  const error = (answer.body as Partial<ErrorBody> | null)?.error;
  const missingRoute = answer.status === 404 && error?.message === 'There is nothing at this address.';
  const stub = answer.status === 500 && error?.message === 'not implemented';
  if (missingRoute || stub) {
    t.skip(
      `not available yet: waiting for the ${owner} workstream (${answer.status} ${error?.message ?? ''})`,
    );
    return;
  }
  assert.equal(
    answer.status,
    403,
    `expected permission-denied, got ${answer.status} ${JSON.stringify(answer.body)}`,
  );
  assert.equal(error?.status, 'permission-denied');
}

describe('cross-store isolation (§7.4): the supplier of store Y against store X', () => {
  let ctx: TestContext;
  let ownerX: ActorClient;
  let staffX: ActorClient;
  let supplierY: ActorClient;
  let productX: string;
  let storeOrderX: string;
  let issueX: string;
  let issuePhotoX: string;

  before(async () => {
    ctx = await createTestContext();
    await createStore(ctx, { id: STORE_X, name: 'Store X' });
    await createStore(ctx, { id: STORE_Y, name: 'Store Y' });
    ownerX = await newSupplier(ctx, { storeId: STORE_X, storeRole: 'owner' });
    staffX = await newSupplier(ctx, { storeId: STORE_X, storeRole: 'staff' });
    supplierY = await newSupplier(ctx, { storeId: STORE_Y, storeRole: 'owner' });
    productX = (await createProduct(ctx, STORE_X, { sku: 'X-1' })).id;

    // A customer's order with a store order and an issue at store X (the §3.2 shapes, written with SQL).
    const { rows } = await ctx.pool.query<{ id: string }>(
      `INSERT INTO users (id, email, role, status, display_name, doc, created_at, updated_at)
       VALUES ($1, $2, 'customer', 'active', 'Dana Whitfield', '{}'::jsonb, $3, $3) RETURNING id`,
      [randomUUID(), `dana-${randomUUID()}@example.test`, new Date(ctx.clock.now())],
    );
    const customerId = rows[0]!.id;
    const orderId = randomUUID();
    const now = ctx.clock.now();
    await ctx.pool.query(
      `INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
      [
        orderId,
        JSON.stringify({
          number: 'IS-20001',
          customerId,
          source: 'cart',
          status: 'confirmed',
          needsAttention: false,
          payment: { status: 'authorized', captureDeadlineAt: null },
          current: { totalCents: 5000 },
        }),
        new Date(now),
      ],
    );
    storeOrderX = `${orderId}-A`;
    await ctx.pool.query(
      `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $4)`,
      [
        storeOrderX,
        JSON.stringify({
          orderId,
          storeId: STORE_X,
          customerId,
          number: 'IS-20001-A',
          letter: 'A',
          status: 'new',
          fulfilment: 'pickup',
          version: 1,
          deliveryId: null,
          timing: { respondBy: now + 600_000, readyBy: now + 3_600_000, readyByDate: '2026-11-19' },
          acceptOverdue: false,
          rated: false,
          lines: [],
        }),
        JSON.stringify({ pickupCode: '4821', pickupCodeAttempts: 0 }),
        new Date(now),
      ],
    );
    issueX = randomUUID();
    await ctx.pool.query(
      `INSERT INTO issues (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
      [
        issueX,
        JSON.stringify({
          number: 'CASE-20001',
          customerId,
          storeId: STORE_X,
          orderId,
          storeOrderId: storeOrderX,
          status: 'open',
          slaDueAt: now + 86_400_000,
          assignedTo: null,
        }),
        new Date(now),
      ],
    );
    issuePhotoX = `issuePhotos/${issueX}/${randomUUID()}.png`;
    await ctx.pool.query(
      `INSERT INTO files (id, path, upload_key, purpose, uploaded_by, scope_id, content_type, size_bytes, max_bytes,
                          original_name, status, created_at, completed_at)
       VALUES ($1, $2, $3, 'issue_photo', $4, $5, 'image/png', $6, $6, 'photo.png', 'ready', $7, $7)`,
      [randomUUID(), issuePhotoX, `uploads/${randomUUID()}`, customerId, issueX, PNG_SIZE, new Date(now)],
    );
  });
  after(() => ctx.close());

  describe('catalogue and store (this workstream)', () => {
    test('GET /products without listed=true for store X', async (t) => {
      expectDenied(t, await supplierY.get(`/products?storeId=${STORE_X}`), 'catalog');
      expectDenied(t, await supplierY.get(`/products?storeId=${STORE_X}&lowStock=true`), 'catalog');
      assert.equal((await ownerX.get(`/products?storeId=${STORE_X}`)).status, 200);
    });

    test('product PUT, PATCH, DELETE and stock-adjust on store X', async (t) => {
      const body = {
        sku: 'Y-SNEAK',
        name: 'Sneaky listing',
        brand: null,
        categoryId: 'wood',
        unit: 'each',
        size: null,
        description: '',
        priceCents: 100,
        compareAtCents: null,
        stockOnHand: 1,
        maxPerOrder: null,
        weightKg: 1,
        dimsCm: { l: 10, w: 10, h: 10 },
        shipEstimated: false,
        active: true,
        imageKey: null,
        imagePath: null,
      };
      expectDenied(t, await supplierY.put(`/products/${STORE_X}--y-sneak`, body), 'catalog');
      expectDenied(t, await supplierY.patch(`/products/${productX}`, { priceCents: 1 }), 'catalog');
      expectDenied(t, await supplierY.post(`/products/${productX}/stock-adjust`, { delta: -1 }), 'catalog');
      expectDenied(t, await supplierY.del(`/products/${productX}`), 'catalog');
      const { rows } = await ctx.pool.query<{ price: number; stock: number }>(
        `SELECT (doc->>'priceCents')::int AS price, stock_on_hand AS stock FROM products WHERE id = $1`,
        [productX],
      );
      assert.deepEqual(rows[0], { price: 1000, stock: 100 }, 'nothing of store X changed');
      assert.equal((await ownerX.patch(`/products/${productX}`, { priceCents: 1001 })).status, 200);
    });

    test('GET /stores/X/settings', async (t) => {
      expectDenied(t, await supplierY.get(`/stores/${STORE_X}/settings`), 'catalog');
      assert.equal((await ownerX.get(`/stores/${STORE_X}/settings`)).status, 200);
    });

    test('updateStoreProfile for store X, any field', async (t) => {
      expectDenied(
        t,
        await supplierY.call('updateStoreProfile', { storeId: STORE_X, patch: { acceptingOrders: false } }),
        'catalog',
      );
      expectDenied(
        t,
        await supplierY.call('updateStoreProfile', {
          storeId: STORE_X,
          patch: { description: 'Y was here' },
        }),
        'catalog',
      );
      const { rows } = await ctx.pool.query<{ accepting: boolean }>(
        `SELECT accepting_orders AS accepting FROM stores WHERE id = $1`,
        [STORE_X],
      );
      assert.equal(rows[0]?.accepting, true);
    });

    test('presigned uploads for store_photo and product_photo of store X', async (t) => {
      const presign = (purpose: string) =>
        supplierY.post('/files/presign', {
          purpose,
          ownerId: STORE_X,
          fileName: 'a.png',
          contentType: 'image/png',
          sizeBytes: PNG_SIZE,
        });
      expectDenied(t, await presign('store_photo'), 'platform');
      expectDenied(t, await presign('product_photo'), 'platform');
    });
  });

  describe('accounts (auth workstream)', () => {
    test('GET /users?role=supplier&storeId=X', async (t) => {
      expectDenied(t, await supplierY.get(`/users?role=supplier&storeId=${STORE_X}`), 'platform');
    });

    test('inviteSupplierUser for store X', async (t) => {
      expectDenied(
        t,
        await supplierY.call('inviteSupplierUser', {
          storeId: STORE_X,
          email: `intruder-${randomUUID()}@example.test`,
          displayName: 'Intruder',
          storeRole: 'staff',
        }),
        'platform',
      );
    });

    test('setSupplierUserStatus on a user of store X', async (t) => {
      expectDenied(
        t,
        await supplierY.call('setSupplierUserStatus', { uid: staffX.uid, status: 'suspended', reason: 'no' }),
        'platform',
      );
      const { rows } = await ctx.pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
        staffX.uid,
      ]);
      assert.equal(rows[0]?.status, 'active');
    });
  });

  describe('store orders (store-orders workstream)', () => {
    test('GET /store-orders?storeId=X and GET /store-orders/{id}', async (t) => {
      expectDenied(t, await supplierY.get(`/store-orders?storeId=${STORE_X}`), 'store-orders');
      expectDenied(t, await supplierY.get(`/store-orders/${storeOrderX}`), 'store-orders');
    });

    test('the four store-order commands', async (t) => {
      const base = { storeOrderId: storeOrderX, expectedVersion: 1 };
      expectDenied(t, await supplierY.call('acceptStoreOrder', base), 'store-orders');
      expectDenied(
        t,
        await supplierY.call('updateStoreOrderStatus', { ...base, status: 'preparing' }),
        'store-orders',
      );
      expectDenied(
        t,
        await supplierY.call('rejectStoreOrder', { ...base, reason: 'out_of_stock', note: null }),
        'store-orders',
      );
      expectDenied(
        t,
        await supplierY.call('completePickup', { ...base, pickupCode: '4821' }),
        'store-orders',
      );
      const { rows } = await ctx.pool.query<{ status: string; version: number }>(
        'SELECT status, version FROM store_orders WHERE id = $1',
        [storeOrderX],
      );
      assert.deepEqual(rows[0], { status: 'new', version: 1 });
    });
  });

  describe('issues (quotes-issues workstream)', () => {
    test('GET /issues?storeId=X and GET /issues/{id}', async (t) => {
      expectDenied(t, await supplierY.get(`/issues?storeId=${STORE_X}`), 'quotes-issues');
      expectDenied(t, await supplierY.get(`/issues/${issueX}`), 'quotes-issues');
    });

    test('GET /files/url for an issue photo of store X', async (t) => {
      expectDenied(t, await supplierY.get(`/files/url?path=${encodeURIComponent(issuePhotoX)}`), 'platform');
      assert.equal((await ownerX.get(`/files/url?path=${encodeURIComponent(issuePhotoX)}`)).status, 200);
    });
  });

  describe('ledger and payouts (money-comms workstream)', () => {
    test('ledger entries, balance and payouts of store X', async (t) => {
      const payee = `payeeType=store&payeeId=${STORE_X}`;
      expectDenied(t, await supplierY.get(`/ledger-entries?${payee}`), 'money-comms');
      expectDenied(t, await supplierY.get(`/ledger/balance?${payee}`), 'money-comms');
      expectDenied(t, await supplierY.get(`/payouts?${payee}`), 'money-comms');
    });
  });

  describe('support (money-comms workstream)', () => {
    test('the support thread store_X', async (t) => {
      const thread = `store_${STORE_X}`;
      expectDenied(t, await supplierY.get(`/support-threads/${thread}`), 'money-comms');
      expectDenied(t, await supplierY.get(`/support-threads/${thread}/messages`), 'money-comms');
      expectDenied(
        t,
        await supplierY.post(`/support-threads/${thread}/messages`, {
          id: randomUUID(),
          text: 'Hello from Y',
          context: null,
        }),
        'money-comms',
      );
      expectDenied(t, await supplierY.post(`/support-threads/${thread}/read`, {}), 'money-comms');
    });
  });

  describe('live topics (platform)', () => {
    test('every store-scoped topic of store X is denied; store Y’s own are granted', async () => {
      const socket = await supplierY.live();
      try {
        const topics = [
          `store:${STORE_X}:orders`,
          `store:${STORE_X}:issues`,
          `store:${STORE_X}:payouts`,
          `store-order:${storeOrderX}`,
          `issue:${issueX}`,
          `support-thread:store_${STORE_X}`,
        ];
        const answer = await socket.subscribe([
          ...topics,
          `store:${STORE_Y}:orders`,
          `support-thread:store_${STORE_Y}`,
        ]);
        assert.deepEqual(
          answer.topics.sort(),
          [`store:${STORE_Y}:orders`, `support-thread:store_${STORE_Y}`].sort(),
        );
        assert.deepEqual(answer.denied.map((entry) => entry.topic).sort(), [...topics].sort());
        for (const entry of answer.denied) assert.equal(entry.reason, 'permission-denied', entry.topic);
      } finally {
        socket.close();
      }
    });
  });

  test('no answer to the supplier of Y ever carries a private shape of store X', async () => {
    const answers = await Promise.all([
      supplierY.get(`/stores/${STORE_X}`),
      supplierY.get(`/products/${productX}`),
      supplierY.get(`/products?listed=true&storeId=${STORE_X}`),
    ]);
    for (const answer of answers) {
      assert.equal(answer.status, 200);
      const text = JSON.stringify(answer.body);
      for (const secret of [
        'commissionBps',
        'payoutAccount',
        'loadingNotes',
        'alertPhone',
        '4821',
        'pickupCode',
      ])
        assert.ok(!text.includes(secret), `leaks ${secret}`);
    }
  });
});
