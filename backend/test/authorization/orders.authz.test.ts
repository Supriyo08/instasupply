/**
 * Orders, store orders and their private part (docs/PLATFORM.md §5.3.5, §7.3, §12.4; MARKETPLACE §13.2):
 * customers read only their own orders and store orders; a supplier's list is always scoped to their store and
 * another storeId is denied; drivers never read orders or store orders; `private` is staff-only; a store order
 * never contains the PIN (it travels on the customer's order only); the commerce commands check their caller.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  Order,
  Page,
  PlaceOrderRequest,
  PlaceOrderResponse,
  PricedCheckout,
  StoreOrder,
} from '@instasupply/shared';
import { as, type ActorClient } from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { seedAccounts } from '../support/fixtures';
import { command, expectError, expectOk, get } from '../support/http';

let ctx: TestContext;
let dana: ActorClient;
let sam: ActorClient;
let kestrelOwner: ActorClient;
let kestrelStaff: ActorClient;
let voltwayOwner: ActorClient;
let marco: ActorClient;
let dispatcher: ActorClient;
let admin: ActorClient;
let delivery: PlaceOrderResponse;
let pickup: PlaceOrderResponse;

async function idOf(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>(sql, params);
  return rows[0]!.id;
}

async function placeFor(
  actor: ActorClient,
  request: Omit<PlaceOrderRequest, 'expectedTotalCents'>,
): Promise<PlaceOrderResponse> {
  const priced = await expectError(
    actor.call('placeOrder', { ...request, expectedTotalCents: 1 }),
    412,
    'PRICE_CHANGED',
  );
  const total = (priced.details.pricing as PricedCheckout).totalCents;
  return expectOk(actor.call<PlaceOrderResponse>('placeOrder', { ...request, expectedTotalCents: total }));
}

const hasKey = (value: unknown, key: string): boolean => JSON.stringify(value).includes(`"${key}"`);

before(async () => {
  ctx = await createTestContext();
  await seedAccounts(ctx);
  dana = await as(ctx, 'dana');
  sam = await as(ctx, 'sam');
  kestrelOwner = await as(ctx, 'kestrelOwner');
  kestrelStaff = await as(ctx, 'kestrelStaff');
  voltwayOwner = await as(ctx, 'voltwayOwner');
  marco = await as(ctx, 'marco');
  dispatcher = await as(ctx, 'dispatcher');
  admin = await as(ctx, 'admin');
  delivery = await placeFor(dana, {
    checkoutId: randomUUID(),
    items: [
      { productId: 'bluestone-drywall--bdp-dw12', storeId: 'bluestone-drywall', quantity: 6 },
      { productId: 'kestrel-lumber--kly-spf248', storeId: 'kestrel-lumber', quantity: 20 },
    ],
    fulfilment: 'delivery',
    jobsiteId: await idOf(`SELECT id FROM jobsites WHERE user_id = $1 AND is_default`, [dana.uid]),
    windowId: 'asap',
    receiving: null,
    siteContact: null,
    instructions: null,
    unloadHelpStoreIds: [],
    cardId: await idOf(`SELECT id FROM cards WHERE user_id = $1 AND last4 = '4242'`, [dana.uid]),
    promoCode: null,
  });
  pickup = await placeFor(sam, {
    checkoutId: randomUUID(),
    items: [{ productId: 'kestrel-lumber--kly-osb716', storeId: 'kestrel-lumber', quantity: 2 }],
    fulfilment: 'pickup',
    jobsiteId: null,
    windowId: null,
    receiving: null,
    siteContact: null,
    instructions: null,
    unloadHelpStoreIds: [],
    cardId: await idOf(`SELECT id FROM cards WHERE user_id = $1`, [sam.uid]),
    promoCode: null,
  });
});

after(async () => {
  await ctx?.close();
});

describe('orders (MARKETPLACE §6.2 orders, storeOrders, private/meta → PLATFORM §5.3.5, §7.3)', () => {
  test('anonymous callers are unauthenticated everywhere', async () => {
    await expectError(get(ctx, '/orders'), 401);
    await expectError(get(ctx, `/orders/${delivery.orderId}`), 401);
    await expectError(get(ctx, `/store-orders/${delivery.storeOrders[0]!.storeOrderId}`), 401);
    await expectError(command(ctx, 'placeOrder', {}), 401);
    await expectError(command(ctx, 'cancelOrder', { orderId: delivery.orderId }), 401);
  });

  test('a customer reads only their own orders', async () => {
    const own = await expectOk(dana.get<Order>(`/orders/${delivery.orderId}`));
    assert.equal(own.customerId, dana.uid);
    await expectError(sam.get(`/orders/${delivery.orderId}`), 403);
    const list = await expectOk(sam.get<Page<Order>>('/orders'));
    assert.deepEqual(
      list.items.map((order) => order.id),
      [pickup.orderId],
    );
    await expectError(sam.get(`/orders?customerId=${dana.uid}`), 403);
    const scoped = await expectOk(sam.get<Page<Order>>(`/orders?customerId=${sam.uid}`));
    assert.equal(scoped.items.length, 1);
    for (const staffOnly of ['storeId=kestrel-lumber', 'needsAttention=true', 'paymentStatus=authorized']) {
      await expectError(dana.get(`/orders?${staffOnly}`), 400);
    }
  });

  test('suppliers and drivers never read orders', async () => {
    for (const actor of [kestrelOwner, kestrelStaff, marco]) {
      await expectError(actor.get('/orders'), 403);
      await expectError(actor.get(`/orders/${delivery.orderId}`), 403);
    }
  });

  test('staff read every order and filter freely', async () => {
    for (const staff of [dispatcher, admin]) {
      const all = await expectOk(staff.get<Page<Order>>('/orders'));
      assert.deepEqual(
        new Set(all.items.map((order) => order.id)),
        new Set([delivery.orderId, pickup.orderId]),
      );
      const bluestone = await expectOk(staff.get<Page<Order>>('/orders?storeId=bluestone-drywall'));
      assert.deepEqual(
        bluestone.items.map((order) => order.id),
        [delivery.orderId],
      );
      const byCustomer = await expectOk(
        staff.get<Page<Order>>(`/orders?customerId=${sam.uid}&paymentStatus=authorized`),
      );
      assert.deepEqual(
        byCustomer.items.map((order) => order.id),
        [pickup.orderId],
      );
      await expectOk(staff.get<Order>(`/orders/${pickup.orderId}`));
    }
  });

  test('store orders: the customer by id and by own order; members of the store; staff', async () => {
    const [a, b] = delivery.storeOrders;
    await expectOk(dana.get<StoreOrder>(`/store-orders/${a!.storeOrderId}`));
    await expectError(sam.get(`/store-orders/${a!.storeOrderId}`), 403);
    const byOrder = await expectOk(dana.get<Page<StoreOrder>>(`/store-orders?orderId=${delivery.orderId}`));
    assert.equal(byOrder.items.length, 2);
    await expectError(sam.get(`/store-orders?orderId=${delivery.orderId}`), 403);
    const kestrel = delivery.storeOrders.find((so) => so.storeId === 'kestrel-lumber')!;
    await expectOk(kestrelOwner.get(`/store-orders/${kestrel.storeOrderId}`));
    await expectOk(kestrelStaff.get(`/store-orders/${kestrel.storeOrderId}`));
    await expectError(voltwayOwner.get(`/store-orders/${kestrel.storeOrderId}`), 403);
    await expectError(marco.get(`/store-orders/${b!.storeOrderId}`), 403);
    await expectError(marco.get('/store-orders'), 403);
    await expectOk(dispatcher.get(`/store-orders/${b!.storeOrderId}`));
  });

  test("a supplier's list is always scoped to their store; another storeId is denied", async () => {
    const own = await expectOk(kestrelOwner.get<Page<StoreOrder>>('/store-orders'));
    assert.ok(own.items.length >= 2);
    assert.ok(own.items.every((so) => so.storeId === 'kestrel-lumber'));
    await expectError(kestrelOwner.get('/store-orders?storeId=bluestone-drywall'), 403);
    const none = await expectOk(voltwayOwner.get<Page<StoreOrder>>('/store-orders'));
    assert.equal(none.items.length, 0);
  });

  test('private meta is staff-only', async () => {
    const id = pickup.storeOrders[0]!.storeOrderId;
    const meta = await expectOk(dispatcher.get<{ pickupCode: string | null }>(`/store-orders/${id}/private`));
    assert.match(String(meta.pickupCode), /^\d{4}$/);
    for (const actor of [kestrelOwner, kestrelStaff, sam, marco])
      await expectError(actor.get(`/store-orders/${id}/private`), 403);
  });

  test('a store order never contains the PIN; the customer reads it on their order only', async () => {
    const id = pickup.storeOrders[0]!.storeOrderId;
    const meta = await expectOk(admin.get<{ pickupCode: string }>(`/store-orders/${id}/private`));
    for (const actor of [sam, kestrelOwner, dispatcher]) {
      const so = await expectOk(actor.get<StoreOrder>(`/store-orders/${id}`));
      assert.ok(!hasKey(so, 'pickupCode'), 'no pickupCode key on a store order');
      assert.ok(!JSON.stringify(so).includes(`"${meta.pickupCode}"`));
      const list = await expectOk(actor.get<Page<StoreOrder>>(`/store-orders?orderId=${pickup.orderId}`));
      assert.ok(!hasKey(list, 'pickupCode'));
    }
    const order = await expectOk(sam.get<Order>(`/orders/${pickup.orderId}`));
    assert.equal(order.storeOrders[0]?.pickupCode, meta.pickupCode);
    const deliveryOrder = await expectOk(dana.get<Order>(`/orders/${delivery.orderId}`));
    assert.ok(deliveryOrder.storeOrders.every((summary) => summary.pickupCode === null));
  });

  test('the commerce commands check their caller', async () => {
    await expectError(sam.call('cancelOrder', { orderId: delivery.orderId }), 403);
    await expectError(kestrelOwner.call('cancelOrder', { orderId: delivery.orderId }), 403);
    await expectError(dispatcher.call('cancelOrder', { orderId: delivery.orderId }), 403);
    await expectError(kestrelOwner.call('placeOrder', { checkoutId: randomUUID() }), 403);
    await expectError(marco.call('placeOrder', { checkoutId: randomUUID() }), 403);
    await expectError(dana.call('cancelOrder', { orderId: 'not-a-uuid' }), 400);
    await expectError(dana.call('cancelOrder', { orderId: randomUUID() }), 404);
  });
});
