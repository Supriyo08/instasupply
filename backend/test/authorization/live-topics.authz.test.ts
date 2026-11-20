import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Actor } from '../../src/platform/auth/actor';
import { authorizeTopic } from '../../src/platform/live/topics';
import { createTestContext, insertStore, type TestContext } from '../platform/context';

const actor = (over: Partial<Actor>): Actor => ({
  uid: 'u',
  sessionId: 's',
  email: 'e@example.com',
  role: null,
  status: 'active',
  name: 'n',
  isStaff: false,
  isAdmin: false,
  isActive: true,
  phoneVerified: false,
  storeId: null,
  storeRole: null,
  cityId: null,
  capacityClass: null,
  ...over,
});

describe('live topics (§8.2) against every actor', () => {
  let ctx: TestContext;
  const customerA = actor({ uid: 'cust-a', role: 'customer' });
  const customerB = actor({ uid: 'cust-b', role: 'customer' });
  const ownerX = actor({ uid: 'own-x', role: 'supplier', storeId: 'store-x', storeRole: 'owner' });
  const staffX = actor({ uid: 'staff-x', role: 'supplier', storeId: 'store-x', storeRole: 'staff' });
  const supplierY = actor({ uid: 'sup-y', role: 'supplier', storeId: 'store-y', storeRole: 'owner' });
  const driver = actor({
    uid: 'drv',
    role: 'driver',
    cityId: 'toronto' as Actor['cityId'],
    capacityClass: 'pickup' as Actor['capacityClass'],
  });
  const pendingDriver = actor({ uid: 'drv-p', role: 'driver', status: 'pending', isActive: false });
  const dispatcher = actor({ uid: 'disp', role: 'dispatcher', isStaff: true });

  before(async () => {
    ctx = await createTestContext();
    await insertStore(ctx, 'store-x');
    await ctx.pool.query(
      `INSERT INTO users (id, email, role, created_at, updated_at) VALUES ('cust-a', 'a@x.test', 'customer', now(), now()),
         ('cust-b', 'b@x.test', 'customer', now(), now())`,
    );
    const orderId = '6f1c2b8e-7d1a-4c3b-9a5e-1f2d3c4b5a69';
    const doc = {
      number: 'IS-10001',
      customerId: 'cust-a',
      source: 'cart',
      status: 'placed',
      needsAttention: false,
      payment: { status: 'authorized' },
      current: { totalCents: 100 },
    };
    await ctx.pool.query(
      `INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, now(), now())`,
      [orderId, JSON.stringify(doc)],
    );
  });
  after(() => ctx.close());

  const check = (who: Actor | null, topic: string) => authorizeTopic(ctx.pool, who, topic);

  test('public topics need no auth; an unknown tracking token is not-found', async () => {
    for (const topic of ['categories', 'stores', 'store:store-x', 'store:store-x:products', 'product:p1']) {
      assert.equal(await check(null, topic), null, topic);
    }
    assert.equal(await check(null, 'tracking:unknown'), 'not-found');
  });

  test('private topics: anonymous unauthenticated, unknown patterns not-found', async () => {
    assert.equal(await check(null, 'user:cust-a'), 'unauthenticated');
    assert.equal(await check(customerA, 'user:cust-a:bogus'), 'not-found');
    assert.equal(await check(customerA, 'ops:everything'), 'not-found');
  });

  test('user and order topics: the owner and staff only', async () => {
    assert.equal(await check(customerA, 'user:cust-a:orders'), null);
    assert.equal(await check(customerB, 'user:cust-a:orders'), 'permission-denied');
    const order = 'order:6f1c2b8e-7d1a-4c3b-9a5e-1f2d3c4b5a69';
    assert.equal(await check(customerA, order), null);
    assert.equal(await check(customerB, order), 'permission-denied');
    assert.equal(await check(dispatcher, order), null);
    assert.equal(await check(ownerX, order), 'permission-denied');
    assert.equal(await check(customerA, 'order:00000000-0000-4000-8000-000000000000'), 'not-found');
  });

  test('store topics: members; payouts the owner only; another store never', async () => {
    assert.equal(await check(staffX, 'store:store-x:orders'), null);
    assert.equal(await check(staffX, 'store:store-x:payouts'), 'permission-denied');
    assert.equal(await check(ownerX, 'store:store-x:payouts'), null);
    assert.equal(await check(supplierY, 'store:store-x:orders'), 'permission-denied');
    assert.equal(await check(supplierY, 'support-thread:store_store-x'), 'permission-denied');
    assert.equal(await check(ownerX, 'support-thread:store_store-x'), null);
  });

  test('job offers: the driver’s own city and class only; pending drivers never; staff always', async () => {
    assert.equal(await check(driver, 'job-offers:toronto:pickup'), null);
    assert.equal(await check(driver, 'job-offers:mississauga:pickup'), 'permission-denied');
    assert.equal(await check(driver, 'job-offers:toronto:car'), 'permission-denied');
    assert.equal(await check(pendingDriver, 'job-offers:toronto:pickup'), 'permission-denied');
    assert.equal(await check(dispatcher, 'job-offers:toronto:car'), null);
  });

  test('ops and driver-locations: staff only', async () => {
    assert.equal(await check(dispatcher, 'ops:orders'), null);
    assert.equal(await check(dispatcher, 'driver-locations'), null);
    assert.equal(await check(driver, 'driver-locations'), 'permission-denied');
    assert.equal(await check(customerA, 'ops:orders'), 'permission-denied');
    assert.equal(await check(driver, 'driver:drv:deliveries'), null);
    assert.equal(await check(driver, 'thread:drv'), null);
    assert.equal(await check(customerA, 'thread:drv'), 'permission-denied');
  });
});
