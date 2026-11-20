/**
 * Checkout workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3): multi-store placement equals priceCheckout;
 * PRICE_CHANGED, WINDOW_UNAVAILABLE, OUT_OF_RANGE, OUT_OF_STOCK; the same checkoutId twice, serially and
 * concurrently; a declined card writes nothing but a `declined` journal row; two concurrent first orders; the
 * last units; whole and partial cancel; capture once at settlement, clamped; capture failure ••0341 → staff
 * alert → sweep retry; deadline capture, then the automatic refund (once); a reduction during the capture;
 * void against attach; finalize twice; an orphaned authorization voided by captureDuePayments.
 *
 * Every case runs through the real commands over app.inject. Where a case needs store orders to settle, the
 * store-order rows are moved in SQL and the aggregate is run exactly as a store-order transaction would run
 * it (lockGraph, then projectOrderAggregate), so these cases test the commerce and payments code alone.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  settleStoreOrder,
  type Order,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type PricedCheckout,
  type StoreOrder,
} from '@instasupply/shared';
import { lockGraph } from '../../src/platform/db/locks';
import { withTransaction } from '../../src/platform/db/tx';
import { projectOrderAggregate } from '../../src/modules/commerce';
import { authorizeOrderPayment, finalizeOrderPayment } from '../../src/modules/payments';
import { as, newCustomer, type ActorClient } from '../support/actors';
import { MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import {
  createCard,
  createJobsite,
  createProduct,
  createStore,
  seedAccounts,
  SEED_JOBSITES,
} from '../support/fixtures';
import { expectError, expectOk, type ErrorEnvelope } from '../support/http';
import { outboxEvents } from '../support/outbox';
import { hold, race } from '../support/race';

const DRYWALL = 'bluestone-drywall--bdp-dw12';
const COMPOUND = 'bluestone-drywall--bdp-jc17';
const STUD = 'kestrel-lumber--kly-spf248';
const OSB = 'kestrel-lumber--kly-osb716';

/** V1 (MARKETPLACE §3.11): Bluestone A, Kestrel B, labourer for Kestrel, Leslieville, ASAP. */
const V1_ITEMS: PlaceOrderRequest['items'] = [
  { productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 6 },
  { productId: COMPOUND, storeId: 'bluestone-drywall', quantity: 1 },
  { productId: STUD, storeId: 'kestrel-lumber', quantity: 20 },
  { productId: OSB, storeId: 'kestrel-lumber', quantity: 4 },
];

interface Shopper {
  actor: ActorClient;
  jobsiteId: string;
  cardId: string;
}

let ctx: TestContext;
let phoneSerial = 2000;

async function jobsiteOf(uid: string, label: string): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM jobsites WHERE user_id = $1 AND doc->>'label' = $2`,
    [uid, label],
  );
  return rows[0]!.id;
}

async function cardOf(uid: string, last4: string): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    'SELECT id FROM cards WHERE user_id = $1 AND last4 = $2',
    [uid, last4],
  );
  return rows[0]!.id;
}

/** A customer with a verified phone, the Leslieville jobsite and one card. */
async function shopper(last4 = '4242', jobsite: Parameters<typeof createJobsite>[2] = {}): Promise<Shopper> {
  phoneSerial += 1;
  const actor = await newCustomer(ctx, {
    phoneNumber: `+1416555${String(phoneSerial)}`,
    phoneVerified: true,
  });
  const site = await createJobsite(ctx, actor.uid, {
    ...SEED_JOBSITES.leslieville,
    ...jobsite,
    isDefault: true,
  });
  const card = await createCard(ctx, actor.uid, { last4, isDefault: true });
  return { actor, jobsiteId: site.id, cardId: card.id };
}

function body(who: Shopper, overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
  return {
    checkoutId: randomUUID(),
    items: V1_ITEMS,
    fulfilment: 'delivery',
    jobsiteId: who.jobsiteId,
    windowId: 'asap',
    receiving: null,
    siteContact: null,
    instructions: null,
    unloadHelpStoreIds: ['kestrel-lumber'],
    cardId: who.cardId,
    promoCode: null,
    expectedTotalCents: 0,
    ...overrides,
  };
}

/** The server's pricing, read the way a client does: a wrong total answers PRICE_CHANGED with it. */
async function priceOf(who: Shopper, request: PlaceOrderRequest): Promise<PricedCheckout> {
  const envelope = await expectError(
    who.actor.call('placeOrder', { ...request, expectedTotalCents: 1 }),
    'failed-precondition',
    'PRICE_CHANGED',
  );
  return envelope.details.pricing as PricedCheckout;
}

async function place(who: Shopper, overrides: Partial<PlaceOrderRequest> = {}): Promise<PlaceOrderResponse> {
  const request = body(who, overrides);
  const pricing = await priceOf(who, request);
  return expectOk(
    who.actor.call<PlaceOrderResponse>('placeOrder', { ...request, expectedTotalCents: pricing.totalCents }),
  );
}

async function orderOf(id: string): Promise<Order> {
  const { rows } = await ctx.pool.query<{
    doc: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>;
    created_at: number;
    updated_at: number;
  }>('SELECT doc, created_at, updated_at FROM orders WHERE id = $1', [id]);
  const row = rows[0]!;
  return { ...row.doc, id, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function storeOrdersOf(orderId: string): Promise<StoreOrder[]> {
  const { rows } = await ctx.pool.query<{
    id: string;
    doc: Omit<StoreOrder, 'id'>;
    created_at: number;
    updated_at: number;
  }>(`SELECT id, doc, created_at, updated_at FROM store_orders WHERE order_id = $1 ORDER BY id COLLATE "C"`, [
    orderId,
  ]);
  return rows.map((row) => ({
    ...row.doc,
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function journalOf(orderId: string) {
  const { rows } = await ctx.pool.query<{ status: string; attempt: number; intent_ref: string | null }>(
    'SELECT status, attempt, intent_ref FROM payment_authorizations WHERE order_id = $1',
    [orderId],
  );
  return rows[0] ?? null;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await ctx.pool.query<Record<string, unknown>>(sql, params);
  return Number(Object.values(rows[0]!)[0]);
}

async function reservedOf(productId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ reserved: number }>('SELECT reserved FROM products WHERE id = $1', [
    productId,
  ]);
  return rows[0]!.reserved;
}

async function statsOf(uid: string): Promise<{ nonCancelledOrders: number; completedOrders: number }> {
  const { rows } = await ctx.pool.query<{ stats: { nonCancelledOrders: number; completedOrders: number } }>(
    `SELECT doc->'stats' AS stats FROM users WHERE id = $1`,
    [uid],
  );
  return rows[0]!.stats;
}

/**
 * Moves one store order the way a store-order transaction would (status, lines, version), then runs the
 * aggregate in that transaction under lockGraph: the projection, finalize and the automatic refund decide.
 */
async function moveStoreOrder(
  storeOrderId: string,
  change: { status?: StoreOrder['status']; shortLine?: { lineId: string; fulfilledQty: number } },
): Promise<void> {
  await withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, { storeOrderIds: [storeOrderId] });
    const row = graph.storeOrders.get(storeOrderId)!;
    const so = { ...(row.doc as unknown as StoreOrder) };
    if (change.shortLine) {
      const short = change.shortLine;
      so.lines = so.lines.map((line) =>
        line.lineId === short.lineId
          ? { ...line, fulfilledQty: short.fulfilledQty, shortReason: 'out_of_stock' }
          : line,
      );
      so.current = settleStoreOrder(so.lines, so.placed);
      so.storeValueCents = so.lines.reduce((sum, line) => sum + line.unitPriceCents * line.fulfilledQty, 0);
    }
    if (change.status) {
      so.status = change.status;
      if (change.status === 'rejected' || change.status === 'cancelled') {
        so.current = {
          itemsCents: 0,
          discountCents: 0,
          deliveryFeeCents: 0,
          unloadFeeCents: 0,
          taxCents: 0,
          totalCents: 0,
        };
      }
      if (change.status === 'picked_up' || change.status === 'delivered') so.completedAt = tx.now;
    }
    so.version += 1;
    await tx.query('UPDATE store_orders SET doc = $2::jsonb, updated_at = $3 WHERE id = $1', [
      storeOrderId,
      JSON.stringify(so),
      new Date(tx.now),
    ]);
    await projectOrderAggregate(tx, graph, row.order_id);
  });
}

async function settleAll(orderId: string, status: StoreOrder['status'] = 'delivered'): Promise<void> {
  for (const so of await storeOrdersOf(orderId)) await moveStoreOrder(so.id, { status });
}

const pickupOne = (productId: string, storeId: string, quantity = 1): Partial<PlaceOrderRequest> => ({
  items: [{ productId, storeId, quantity }],
  fulfilment: 'pickup',
  jobsiteId: null,
  windowId: null,
  unloadHelpStoreIds: [],
});

before(async () => {
  ctx = await createTestContext();
  await seedAccounts(ctx);
});

after(async () => {
  await ctx?.close();
});

describe('checkout workflow (MARKETPLACE §5.5.1, §3.8 → PLATFORM §9.2.1, §9.2.3, §9.2.12, §10.4)', () => {
  test('V1: a multi-store placement equals priceCheckout and writes the whole graph', async () => {
    const dana = await as(ctx, 'dana');
    const who: Shopper = {
      actor: dana,
      jobsiteId: await jobsiteOf(dana.uid, 'Leslieville semi reno'),
      cardId: await cardOf(dana.uid, '4242'),
    };
    const reservedBefore = await reservedOf(STUD);
    const request = body(who);
    const pricing = await priceOf(who, request);
    assert.equal(pricing.totalCents, 38_825, 'V1 total $388.25');
    assert.deepEqual(
      pricing.stores.map((s) => [s.letter, s.storeId, s.totalCents]),
      [
        ['A', 'bluestone-drywall', 14_949],
        ['B', 'kestrel-lumber', 23_876],
      ],
    );
    const answer = await expectOk(
      dana.call<PlaceOrderResponse>('placeOrder', { ...request, expectedTotalCents: pricing.totalCents }),
    );
    assert.equal(answer.orderId, request.checkoutId);
    assert.match(answer.number, /^IS-\d{5}$/);
    assert.equal(answer.totalCents, 38_825);
    assert.deepEqual(
      answer.storeOrders.map((so) => [so.storeId, so.number]),
      [
        ['bluestone-drywall', `${answer.number}-A`],
        ['kestrel-lumber', `${answer.number}-B`],
      ],
    );

    const order = await expectOk(dana.get<Order>(`/orders/${answer.orderId}`));
    assert.equal(order.status, 'placed');
    assert.equal(order.isFirstOrder, true);
    assert.equal(order.countsTowardFirstOrder, true);
    assert.equal(order.placed.totalCents, 38_825);
    assert.deepEqual(order.current, {
      itemsCents: pricing.itemsCents,
      discountCents: pricing.discountCents,
      deliveryFeeCents: 0,
      unloadFeeCents: 3_500,
      taxCents: pricing.taxCents,
      totalCents: 38_825,
    });
    assert.equal(order.payment.status, 'authorized');
    assert.equal(order.payment.authorizedCents, 38_825);
    assert.equal(order.payment.intentRef, `test_pi_${answer.orderId}`);
    assert.equal(order.payment.events[0]?.type, 'authorize');
    assert.equal(order.payment.events[0]?.idempotencyKey, `auth_${answer.orderId}`);
    assert.equal(order.storeOrders.length, 2);
    for (const summary of order.storeOrders) {
      assert.ok(summary.trackingToken, 'every delivery store order carries its tracking token on the order');
      assert.equal(summary.pickupCode, null);
    }
    assert.ok(order.window && order.window.kind === 'asap');

    const storeOrders = await storeOrdersOf(answer.orderId);
    assert.deepEqual(
      storeOrders.map((so) => [so.letter, so.status, so.current.totalCents, so.version]),
      [
        ['A', 'new', 14_949, 0],
        ['B', 'new', 23_876, 0],
      ],
    );
    const kestrel = storeOrders[1]!;
    assert.equal(kestrel.unload.selected, true);
    assert.equal(
      kestrel.lines.reduce((sum, line) => sum + line.discountCents, 0),
      1_143,
    );
    assert.ok(kestrel.deliveryId);
    assert.equal(
      await count('SELECT count(*) FROM deliveries WHERE source_order_id = $1', [answer.orderId]),
      2,
    );
    assert.equal(await reservedOf(STUD), reservedBefore + 20);
    assert.equal((await statsOf(dana.uid)).nonCancelledOrders, 1);
    assert.equal((await journalOf(answer.orderId))?.status, 'attached');
    const lastUsed = await count('SELECT count(*) FROM jobsites WHERE id = $1 AND last_used_at IS NOT NULL', [
      who.jobsiteId,
    ]);
    assert.equal(lastUsed, 1);
    const placedNote = await count(
      `SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'order_placed' AND dedupe_key = $2`,
      [dana.uid, `order-placed-${answer.orderId}`],
    );
    assert.equal(placedNote, 1);

    // The same checkoutId again: the stored answer, nothing new written, no new authorization.
    const authorizations = ctx.gateway.of('authorize').length;
    const again = await expectOk(
      dana.call<PlaceOrderResponse>('placeOrder', { ...request, expectedTotalCents: pricing.totalCents }),
    );
    assert.deepEqual(again, answer);
    assert.equal(ctx.gateway.of('authorize').length, authorizations);
    assert.equal(await count('SELECT count(*) FROM orders WHERE id = $1', [answer.orderId]), 1);
    assert.equal(await reservedOf(STUD), reservedBefore + 20);

    // Another customer with the same checkoutId: a generic already-exists.
    const sam = await as(ctx, 'sam');
    await expectError(
      sam.call('placeOrder', {
        ...request,
        jobsiteId: await jobsiteOf(sam.uid, 'Home — Danforth'),
        cardId: await cardOf(sam.uid, '4242'),
      }),
      409,
    );
  });

  test('PRICE_CHANGED, WINDOW_UNAVAILABLE, OUT_OF_RANGE and OUT_OF_STOCK write nothing', async () => {
    const who = await shopper();
    const orders = await count('SELECT count(*) FROM orders');

    const changed = await expectError(
      who.actor.call('placeOrder', body(who, { expectedTotalCents: 1 })),
      412,
      'PRICE_CHANGED',
    );
    assert.equal(typeof (changed.details.pricing as PricedCheckout).totalCents, 'number');

    // 13:00 today is less than 90 minutes after 12:25.
    const window = await expectError(
      who.actor.call('placeOrder', body(who, { windowId: '2026-11-19T13:00' })),
      412,
      'WINDOW_UNAVAILABLE',
    );
    const windows = window.details.windows as { id: string; available: boolean }[];
    assert.equal(windows[0]?.id, 'asap');
    assert.ok(windows.some((option) => option.available && option.id !== 'asap'));

    const near = await createStore(ctx, { name: 'Tiny Radius Supply', deliveryRadiusKm: 1 });
    const product = await createProduct(ctx, near.id, { priceCents: 1500 });
    const range = await expectError(
      who.actor.call(
        'placeOrder',
        body(who, {
          items: [{ productId: product.id, storeId: near.id, quantity: 1 }],
          unloadHelpStoreIds: [],
        }),
      ),
      412,
      'OUT_OF_RANGE',
    );
    assert.equal(range.details.storeId, near.id);

    const stock = await expectError(
      who.actor.call(
        'placeOrder',
        body(who, {
          items: [{ productId: COMPOUND, storeId: 'bluestone-drywall', quantity: 9_000 }],
          unloadHelpStoreIds: [],
        }),
      ),
      412,
      'OUT_OF_STOCK',
    );
    assert.equal(stock.details.productId, COMPOUND);
    assert.equal(typeof stock.details.available, 'number');

    assert.equal(await count('SELECT count(*) FROM orders'), orders);
    assert.equal(
      await count('SELECT count(*) FROM payment_authorizations WHERE customer_id = $1', [who.actor.uid]),
      0,
    );
  });

  test('a declined card ••0002 writes nothing but a declined journal row', async () => {
    const who = await shopper('0002');
    const reserved = await reservedOf(STUD);
    const request = body(who);
    const pricing = await priceOf(who, request);
    const envelope = await expectError(
      who.actor.call('placeOrder', { ...request, expectedTotalCents: pricing.totalCents }),
      412,
      'CARD_DECLINED',
    );
    assert.equal(envelope.details.reason, 'card_declined');
    assert.equal(await count('SELECT count(*) FROM orders WHERE id = $1', [request.checkoutId]), 0);
    assert.equal(
      await count('SELECT count(*) FROM store_orders WHERE order_id = $1', [request.checkoutId]),
      0,
    );
    assert.equal(await reservedOf(STUD), reserved);
    assert.equal((await statsOf(who.actor.uid)).nonCancelledOrders, 0);
    assert.equal((await journalOf(request.checkoutId))?.status, 'declined');
  });

  test('the same checkoutId twice at once: one order, one intent, zero voids (×25)', async () => {
    await race({
      times: 25,
      setup: async () => {
        const who = await shopper();
        const request = body(who);
        const pricing = await priceOf(who, request);
        ctx.gateway.reset();
        return { who, request: { ...request, expectedTotalCents: pricing.totalCents } };
      },
      run: ({ who, request }) => [
        () => who.actor.call<PlaceOrderResponse>('placeOrder', request),
        () => who.actor.call<PlaceOrderResponse>('placeOrder', request),
      ],
      check: async (results, { who, request }) => {
        for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(results[0]!.body, results[1]!.body);
        const id = request.checkoutId;
        assert.equal(await count('SELECT count(*) FROM orders WHERE id = $1', [id]), 1);
        assert.equal(await count('SELECT count(*) FROM store_orders WHERE order_id = $1', [id]), 2);
        assert.equal(await count('SELECT count(*) FROM deliveries WHERE source_order_id = $1', [id]), 2);
        assert.deepEqual(ctx.gateway.intents(), [`test_pi_${id}`]);
        assert.equal(ctx.gateway.of('void').length, 0);
        assert.equal((await statsOf(who.actor.uid)).nonCancelledOrders, 1);
      },
    });
  });

  test('the same checkoutId twice, A held after its authorization while B completes: zero voids', async () => {
    const who = await shopper();
    const request = body(who);
    const pricing = await priceOf(who, request);
    const full = { ...request, expectedTotalCents: pricing.totalCents };
    ctx.gateway.reset();
    const stud = await reservedOf(STUD);
    const gate = hold(ctx, 'placeOrder:afterAuthorize');
    const first = who.actor.call<PlaceOrderResponse>('placeOrder', full);
    await gate.reached();
    const second = await expectOk(who.actor.call<PlaceOrderResponse>('placeOrder', full));
    gate.release();
    const answer = await expectOk(first);
    assert.deepEqual(answer, second);
    assert.equal(await count('SELECT count(*) FROM orders WHERE id = $1', [request.checkoutId]), 1);
    assert.equal(await reservedOf(STUD), stud + 20, 'reserved rose once');
    assert.equal(ctx.gateway.of('void').length, 0);
    assert.deepEqual(ctx.gateway.intents(), [`test_pi_${request.checkoutId}`]);
  });

  test('two first orders at once: one wins the first-order pricing, the other PRICE_CHANGED and is voided (×25)', async () => {
    const store = await createStore(ctx, { name: 'First Order Supply' });
    const product = await createProduct(ctx, store.id, {
      priceCents: 30_000,
      stockOnHand: 1_000,
      weightKg: 2,
      dimsCm: { l: 40, w: 30, h: 20 },
    });
    await race({
      times: 25,
      setup: async () => {
        const who = await shopper();
        const items = [{ productId: product.id, storeId: store.id, quantity: 1 }];
        const a = body(who, { items, unloadHelpStoreIds: [] });
        const b = body(who, { items, unloadHelpStoreIds: [] });
        const pricing = await priceOf(who, a);
        assert.equal(pricing.discounts[0]?.kind, 'first_order');
        const reserved = await reservedOf(product.id);
        ctx.gateway.reset();
        return {
          who,
          reserved,
          a: { ...a, expectedTotalCents: pricing.totalCents },
          b: { ...b, expectedTotalCents: pricing.totalCents },
        };
      },
      run: ({ who, a, b }) => [() => who.actor.call('placeOrder', a), () => who.actor.call('placeOrder', b)],
      check: async (results, { who, a, b, reserved }) => {
        const winners = results.filter((result) => result.status === 200);
        assert.equal(winners.length, 1, JSON.stringify(results.map((r) => r.body)));
        const loserIndex = results.findIndex((result) => result.status !== 200);
        const loser = results[loserIndex]!.body as { error: ErrorEnvelope };
        assert.equal(loser.error.code, 'PRICE_CHANGED');
        const pricing = loser.error.details.pricing as PricedCheckout;
        assert.equal(pricing.discounts.length, 0, 'no welcome discount for the second order');
        const loserId = loserIndex === 0 ? a.checkoutId : b.checkoutId;
        assert.equal((await journalOf(loserId))?.status, 'voided');
        assert.ok(ctx.gateway.of('void').some((call) => call.input.idempotencyKey === `void_${loserId}`));
        assert.equal((await statsOf(who.actor.uid)).nonCancelledOrders, 1);
        assert.equal(await reservedOf(product.id), reserved + 1);
      },
    });
  });

  test('the last 4 units: one order, the other OUT_OF_STOCK { available: 0 }', async () => {
    const store = await createStore(ctx, { name: 'Last Units Supply' });
    const product = await createProduct(ctx, store.id, { priceCents: 2_000, stockOnHand: 4 });
    const one = await shopper();
    const two = await shopper();
    const items = [{ productId: product.id, storeId: store.id, quantity: 4 }];
    const a = body(one, { items, unloadHelpStoreIds: [] });
    const b = body(two, { items, unloadHelpStoreIds: [] });
    const [pa, pb] = await Promise.all([priceOf(one, a), priceOf(two, b)]);
    const results = await Promise.all([
      one.actor.call('placeOrder', { ...a, expectedTotalCents: pa.totalCents }),
      two.actor.call('placeOrder', { ...b, expectedTotalCents: pb.totalCents }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const failed = results.find((r) => r.status !== 200)!.body as { error: ErrorEnvelope };
    assert.equal(failed.error.code, 'OUT_OF_STOCK');
    assert.equal(failed.error.details.available, 0);
    assert.equal(await reservedOf(product.id), 4);
  });

  test('partial and whole cancel: stock released, delivery cancelled, first-order count given back, hold voided', async () => {
    const who = await shopper();
    const placed = await place(who);
    const [a, b] = placed.storeOrders;
    const drywall = await reservedOf(DRYWALL);
    const stud = await reservedOf(STUD);

    const partial = await expectOk(
      who.actor.call<{ cancelled: string[]; notCancellable: unknown[] }>('cancelOrder', {
        orderId: placed.orderId,
        storeOrderIds: [a!.storeOrderId],
      }),
    );
    assert.deepEqual(partial, { cancelled: [a!.storeOrderId], notCancellable: [] });
    assert.equal(await reservedOf(DRYWALL), drywall - 6);
    const afterPartial = await orderOf(placed.orderId);
    assert.equal(afterPartial.status, 'placed');
    assert.equal(
      afterPartial.current.totalCents,
      (await storeOrdersOf(placed.orderId))[1]!.current.totalCents,
    );
    const deliveryA = await ctx.pool.query<{ status: string }>(
      'SELECT status FROM deliveries WHERE store_order_id = $1',
      [a!.storeOrderId],
    );
    assert.equal(deliveryA.rows[0]?.status, 'cancelled');

    const whole = await expectOk(
      who.actor.call<{ cancelled: string[] }>('cancelOrder', {
        orderId: placed.orderId,
        reason: 'Plans changed',
      }),
    );
    assert.deepEqual(whole.cancelled.sort(), [a!.storeOrderId, b!.storeOrderId].sort());
    assert.equal(await reservedOf(STUD), stud - 20);
    const cancelled = await orderOf(placed.orderId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.countsTowardFirstOrder, false);
    assert.equal(
      (await statsOf(who.actor.uid)).nonCancelledOrders,
      0,
      'a cancelled first order is not counted',
    );

    // Settled with nothing to charge: finalize voids the hold.
    const finalize = await outboxEvents(ctx, 'payment.finalize', 'pending');
    assert.ok(finalize.some((event) => event.payload.orderId === placed.orderId));
    await ctx.drainOutbox();
    const voided = await orderOf(placed.orderId);
    assert.equal(voided.payment.status, 'voided');
    assert.equal((await journalOf(placed.orderId))?.status, 'voided');
    assert.ok(ctx.gateway.of('void').some((call) => call.input.intentRef === `test_pi_${placed.orderId}`));
    assert.equal(
      ctx.gateway.of('capture').filter((c) => c.input.idempotencyKey === `capture_${placed.orderId}`).length,
      0,
    );

    // Nothing left to cancel: the same answer, not a failure.
    const repeat = await expectOk(
      who.actor.call<{ cancelled: string[] }>('cancelOrder', { orderId: placed.orderId }),
    );
    assert.equal(repeat.cancelled.length, 2);
  });

  test('cancel is refused once the store prepares; another customer cannot cancel', async () => {
    const who = await shopper();
    const placed = await place(who, pickupOne(STUD, 'kestrel-lumber', 2));
    const other = await shopper();
    await expectError(other.actor.call('cancelOrder', { orderId: placed.orderId }), 403);
    await moveStoreOrder(placed.storeOrders[0]!.storeOrderId, { status: 'preparing' });
    const refused = await expectError(who.actor.call('cancelOrder', { orderId: placed.orderId }), 412);
    assert.deepEqual(refused.details.notCancellable, [
      { storeOrderId: placed.storeOrders[0]!.storeOrderId, status: 'preparing' },
    ]);
  });

  test('capture once at settlement, clamped to what was supplied; the rest is released', async () => {
    const who = await shopper();
    const placed = await place(who);
    const [a, b] = placed.storeOrders;
    // Bluestone ships 4 of 6 sheets before the hand-over.
    await moveStoreOrder(a!.storeOrderId, { shortLine: { lineId: 'L1', fulfilledQty: 4 } });
    await moveStoreOrder(a!.storeOrderId, { status: 'delivered' });
    assert.equal(
      await count(
        `SELECT count(*) FROM outbox WHERE event = 'payment.finalize' AND payload->>'orderId' = $1`,
        [placed.orderId],
      ),
      0,
      'not settled yet',
    );
    await moveStoreOrder(b!.storeOrderId, { status: 'delivered' });
    await ctx.drainOutbox();

    const order = await orderOf(placed.orderId);
    const storeOrders = await storeOrdersOf(placed.orderId);
    const expected = storeOrders.reduce((sum, so) => sum + so.current.totalCents, 0);
    assert.ok(expected < order.payment.authorizedCents);
    assert.equal(order.payment.status, 'captured');
    assert.equal(order.payment.capturedCents, expected);
    assert.deepEqual(
      order.payment.capturedByStoreOrder,
      Object.fromEntries(storeOrders.map((so) => [so.id, so.current.totalCents])),
    );
    assert.deepEqual(
      order.payment.events.map((event) => event.type),
      ['authorize', 'capture', 'release'],
    );
    assert.equal(order.payment.events[2]?.amountCents, order.payment.authorizedCents - expected);
    assert.equal(order.status, 'completed');
    const captures = ctx.gateway
      .of('capture')
      .filter((call) => call.input.idempotencyKey === `capture_${placed.orderId}`);
    assert.equal(captures.length, 1);
    assert.equal(captures[0]!.input.amountCents, expected);
    assert.equal(
      await count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND dedupe_key = $2`, [
        who.actor.uid,
        `order-complete-${placed.orderId}`,
      ]),
      1,
    );
    assert.equal((await statsOf(who.actor.uid)).completedOrders, 1);
    assert.equal(
      await count(`SELECT count(*) FROM ledger_entries WHERE order_id = $1 AND kind = 'sale'`, [
        placed.orderId,
      ]),
      2,
    );
  });

  test('capture failure ••0341 → capture_failed and a staff alert → the sweep retries', async () => {
    const who = await shopper('0341');
    const placed = await place(who, pickupOne(STUD, 'kestrel-lumber', 2));
    await settleAll(placed.orderId, 'picked_up');
    await ctx.drainOutbox();
    const failed = await orderOf(placed.orderId);
    assert.equal(failed.payment.status, 'capture_failed');
    assert.equal(failed.payment.events.at(-1)?.type, 'capture_failed');
    const admin = await as(ctx, 'admin');
    assert.equal(
      await count(
        `SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'capture_failed' AND data->>'customerOrderId' = $2`,
        [admin.uid, placed.orderId],
      ),
      1,
    );
    ctx.clock.advance(30 * MINUTE);
    const result = await ctx.runJob('captureDuePayments');
    assert.ok((result.retried ?? 0) >= 1);
    const retry = await outboxEvents(ctx, 'payment.finalize', 'pending');
    assert.ok(retry.some((event) => event.payload.orderId === placed.orderId));
    await ctx.drainOutbox();
    const again = await orderOf(placed.orderId);
    assert.equal(again.payment.status, 'capture_failed');
    assert.equal(again.payment.events.filter((event) => event.type === 'capture_failed').length, 2);
  });

  test('deadline capture, then the automatic refund of a later reduction, once (refund once)', async () => {
    const start = ctx.clock.now();
    const who = await shopper();
    const placed = await place(who);
    const [a] = placed.storeOrders;
    const order = await orderOf(placed.orderId);
    ctx.clock.set(order.payment.captureDeadlineAt!);
    const swept = await ctx.runJob('captureDuePayments');
    assert.ok((swept.deadlineCaptured ?? 0) >= 1);
    await ctx.drainOutbox();
    const captured = await orderOf(placed.orderId);
    assert.equal(captured.payment.status, 'captured');
    assert.equal(captured.payment.capturedCents, captured.payment.authorizedCents);
    assert.equal(captured.status, 'placed', 'captured before it settled');

    // Two changes before the refund handler runs: shorted, then moved on.
    const before = (await storeOrdersOf(placed.orderId))[0]!;
    await moveStoreOrder(a!.storeOrderId, { shortLine: { lineId: 'L1', fulfilledQty: 4 } });
    await moveStoreOrder(a!.storeOrderId, { status: 'accepted' });
    const shorted = (await storeOrdersOf(placed.orderId))[0]!;
    const difference = before.current.totalCents - shorted.current.totalCents;
    const refunds = await outboxEvents(ctx, 'payment.refund');
    const mine = refunds.filter((event) => event.payload.storeOrderId === a!.storeOrderId);
    assert.equal(mine.length, 1, 'exactly one payment.refund row for that store order');
    assert.equal(mine[0]!.payload.amountCents, difference);
    assert.match(
      String(mine[0]!.payload.idempotencyKey),
      new RegExp(`^refund_adj_${a!.storeOrderId}_v\\d+$`),
    );
    ctx.gateway.reset();
    await ctx.drainOutbox();
    assert.equal(ctx.gateway.of('refund').length, 1);
    assert.equal(ctx.gateway.of('refund')[0]!.input.amountCents, difference);
    const refunded = await orderOf(placed.orderId);
    assert.equal(refunded.payment.status, 'partially_refunded');
    assert.equal(refunded.payment.refundedCents, difference);
    assert.equal(refunded.payment.adjustedByStoreOrder[a!.storeOrderId], difference);
    assert.equal(
      await count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND type = 'refund_issued'`, [
        who.actor.uid,
      ]),
      1,
    );
    // Running the aggregate again finds nothing more to refund.
    await moveStoreOrder(a!.storeOrderId, { status: 'preparing' });
    assert.equal((await outboxEvents(ctx, 'payment.refund', 'pending')).length, 0);
    ctx.clock.set(start);
  });

  test('a reduction during the capture: the captured breakdown is kept and the reduction refunded in step 3', async () => {
    const start = ctx.clock.now();
    const who = await shopper();
    const placed = await place(who);
    const [a] = placed.storeOrders;
    const order = await orderOf(placed.orderId);
    ctx.clock.set(order.payment.captureDeadlineAt!);
    const breakdownBefore = Object.fromEntries(
      (await storeOrdersOf(placed.orderId)).map((so) => [so.id, so.current.totalCents]),
    );
    const gate = hold(ctx, 'finalize:afterCapture');
    const finalize = finalizeOrderPayment(ctx.deps, placed.orderId, { deadline: true });
    await gate.reached();
    await moveStoreOrder(a!.storeOrderId, { shortLine: { lineId: 'L1', fulfilledQty: 3 } });
    assert.equal(
      (await outboxEvents(ctx, 'payment.refund', 'pending')).filter(
        (e) => e.payload.orderId === placed.orderId,
      ).length,
      0,
    );
    gate.release();
    await finalize;
    const captured = await orderOf(placed.orderId);
    assert.equal(captured.payment.status, 'captured');
    assert.deepEqual(captured.payment.capturedByStoreOrder, breakdownBefore);
    const refunds = (await outboxEvents(ctx, 'payment.refund', 'pending')).filter(
      (e) => e.payload.orderId === placed.orderId,
    );
    assert.equal(refunds.length, 1);
    const shorted = (await storeOrdersOf(placed.orderId))[0]!;
    assert.equal(
      refunds[0]!.payload.amountCents,
      breakdownBefore[a!.storeOrderId]! - shorted.current.totalCents,
    );
    await ctx.drainOutbox();
    ctx.clock.set(start);
  });

  test('finalize twice at once: one capture, one capture event, one "Order complete"', async () => {
    const who = await shopper();
    const placed = await place(who, pickupOne(OSB, 'kestrel-lumber', 1));
    await settleAll(placed.orderId, 'picked_up');
    await ctx.pool.query(`DELETE FROM outbox WHERE event = 'payment.finalize' AND payload->>'orderId' = $1`, [
      placed.orderId,
    ]);
    ctx.gateway.reset();
    await Promise.all([
      finalizeOrderPayment(ctx.deps, placed.orderId),
      finalizeOrderPayment(ctx.deps, placed.orderId),
    ]);
    const order = await orderOf(placed.orderId);
    assert.equal(order.payment.status, 'captured');
    assert.equal(order.payment.events.filter((event) => event.type === 'capture').length, 1);
    const keys = new Set(ctx.gateway.of('capture').map((call) => call.input.idempotencyKey));
    assert.deepEqual([...keys], [`capture_${placed.orderId}`]);
    assert.equal(
      await count(`SELECT count(*) FROM notifications WHERE dedupe_key = $1`, [
        `order-complete-${placed.orderId}`,
      ]),
      1,
    );
  });

  test('void against attach: the sweep voids attempt 1 while placeOrder is held; placeOrder retries with attempt 2', async () => {
    const start = ctx.clock.now();
    const who = await shopper();
    const request = body(who, pickupOne(STUD, 'kestrel-lumber', 3));
    const pricing = await priceOf(who, request);
    ctx.gateway.reset();
    const gate = hold(ctx, 'placeOrder:locked');
    const pending = who.actor.call<PlaceOrderResponse>('placeOrder', {
      ...request,
      expectedTotalCents: pricing.totalCents,
    });
    await gate.reached();
    ctx.clock.advance(16 * MINUTE);
    const swept = await ctx.runJob('captureDuePayments');
    assert.equal(swept.orphansVoided, 1);
    await ctx.drainOutbox();
    assert.equal((await journalOf(request.checkoutId))?.status, 'voided');
    gate.release();
    const answer = await expectOk(pending);
    assert.equal(answer.orderId, request.checkoutId);
    const journal = await journalOf(request.checkoutId);
    assert.deepEqual([journal?.status, journal?.attempt], ['attached', 2]);
    const keys = ctx.gateway.of('authorize').map((call) => call.input.idempotencyKey);
    assert.ok(keys.includes(`auth_${request.checkoutId}`));
    assert.ok(keys.includes(`auth_${request.checkoutId}_r2`));
    const order = await orderOf(request.checkoutId);
    assert.equal(order.payment.status, 'authorized');
    assert.equal(order.payment.events[0]?.idempotencyKey, `auth_${request.checkoutId}_r2`);
    ctx.clock.set(start);
  });

  test('an authorization orphaned by a crash is voided by captureDuePayments', async () => {
    const start = ctx.clock.now();
    const who = await shopper();
    const orderId = randomUUID();
    await authorizeOrderPayment(ctx.deps, {
      orderId,
      amountCents: 12_345,
      customerId: who.actor.uid,
      card: { cardId: who.cardId, brand: 'visa', last4: '4242' },
    });
    assert.equal((await journalOf(orderId))?.status, 'authorized');
    ctx.clock.advance(10 * MINUTE);
    assert.equal((await ctx.runJob('captureDuePayments')).orphansVoided, 0, 'not before 15 minutes');
    ctx.clock.advance(6 * MINUTE);
    assert.equal((await ctx.runJob('captureDuePayments')).orphansVoided, 1);
    await ctx.drainOutbox();
    assert.equal((await journalOf(orderId))?.status, 'voided');
    assert.ok(ctx.gateway.of('void').some((call) => call.input.idempotencyKey === `void_${orderId}`));
    ctx.clock.set(start);
  });

  test('PAYMENTS_MODE=disabled refuses checkout; a driver may not place orders', async () => {
    const marco = await as(ctx, 'marco');
    await expectError(
      marco.call('placeOrder', body({ actor: marco, jobsiteId: randomUUID(), cardId: randomUUID() })),
      403,
    );
    const disabled = await createTestContext({ env: { PAYMENTS_MODE: 'disabled' } });
    try {
      await seedAccounts(disabled);
      const dana = await as(disabled, 'dana');
      await expectError(
        dana.call('placeOrder', body({ actor: dana, jobsiteId: randomUUID(), cardId: randomUUID() })),
        412,
        'PAYMENTS_DISABLED',
      );
    } finally {
      await disabled.close();
    }
  });

  test("GET /orders lists the caller's orders newest first and pages without gaps", async () => {
    const who = await shopper();
    const first = await place(who, pickupOne(STUD, 'kestrel-lumber', 1));
    ctx.clock.advance(MINUTE);
    const second = await place(who, pickupOne(OSB, 'kestrel-lumber', 1));
    const page1 = await expectOk(
      who.actor.get<{ items: Order[]; nextCursor: string | null }>('/orders?limit=1'),
    );
    assert.deepEqual(
      page1.items.map((o) => o.id),
      [second.orderId],
    );
    assert.ok(page1.nextCursor);
    const page2 = await expectOk(
      who.actor.get<{ items: Order[]; nextCursor: string | null }>(
        `/orders?limit=1&cursor=${page1.nextCursor}`,
      ),
    );
    assert.deepEqual(
      page2.items.map((o) => o.id),
      [first.orderId],
    );
    const active = await expectOk(who.actor.get<{ items: Order[] }>('/orders?status=placed,confirmed'));
    assert.equal(active.items.length, 2);
  });
});
