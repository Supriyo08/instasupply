/**
 * Store-order workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3): accept with a shortage (V4), the reject
 * cascade, ready gating, the PIN (wrong ×5 → CODE_LOCKED, staff override, a wrong PIN saves only the attempt),
 * the customer pickup, the driver hand-over with wait pay, hold expiry and reminder → overdue → auto-reject
 * through runJob, the GET /store-orders endpoints, and the concurrency cases "accept twice" and "hand-over
 * against release" of §12.3.
 *
 * Orders are written straight into the tables, shaped exactly as the order writer of §9.2.1 writes them,
 * so this file tests the store-order module on its own data and not the checkout.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  Amounts,
  AppNotification,
  Delivery,
  DeliveryPrivateMeta,
  JobsiteSnapshot,
  LoadSummary,
  Order,
  Page,
  StoreOrder,
  StoreOrderActionResponse,
  StoreOrderLine,
  StoreOrderPrivateMeta,
} from '@instasupply/shared';
import { lockGraph } from '../../src/platform/db/locks';
import { withTransaction } from '../../src/platform/db/tx';
import { newTrackingToken } from '../../src/platform/ids';
import { stagePickupCode } from '../../src/modules/store-orders';
import { newCustomer, newDispatcher, newDriver, newSupplier, type ActorClient } from '../support/actors';
import { MINUTE, REFERENCE_TIME } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { createProduct, createStore } from '../support/fixtures';
import { expectError, expectOk, type Answer } from '../support/http';
import { outboxEvents } from '../support/outbox';
import { race } from '../support/race';

// ---------- fixtures ----------

interface LineSpec {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
}

interface PlacedFixture {
  orderId: string;
  storeOrderId: string;
  deliveryId: string | null;
  number: string;
}

let orderSerial = 10000;

const amounts = (lines: LineSpec[]): Amounts => {
  const items = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const discount = lines.reduce((sum, l) => sum + l.discountCents, 0);
  const tax = Math.round(((items - discount) * 1300) / 10_000);
  return {
    itemsCents: items,
    discountCents: discount,
    deliveryFeeCents: 0,
    unloadFeeCents: 0,
    taxCents: tax,
    totalCents: items - discount + tax,
  };
};

const JOBSITE: JobsiteSnapshot = {
  jobsiteId: null,
  addressLine: 'Pape Ave & Dundas St E, Toronto',
  label: 'Leslieville semi reno',
  line1: 'Pape Ave & Dundas St E',
  line2: null,
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M4M 2E3',
  location: { lat: 43.6648, lng: -79.3405 },
  cityId: 'toronto',
  areaLabel: 'Leslieville · M4M',
  contactName: 'Site Contact',
  contactPhone: '+14165550110',
  instructions: null,
  receiving: 'attended',
  maxVehicleClass: null,
};

const LOAD: LoadSummary = {
  pieces: 26,
  weightG: 12_000,
  weightKg: 12,
  longestCm: 18,
  volumeL: 20,
  hasSheets: false,
  handlingPieces: 0,
  heaviestUnitKg: 3,
  heavy: false,
  vehicleClass: 'car',
  summary: '24 × Joist hanger 2x8, 2 × Deck screws 5 lb',
  lines: [],
};

/**
 * One order with one store order (letter A) of `storeId`, as placeOrder leaves it: `new`, stock reserved,
 * and for delivery an unassigned delivery with `offerStatus: 'held'`, its tracking token and hand-off code.
 */
async function placeFixture(
  ctx: TestContext,
  input: {
    customer: ActorClient;
    storeId: string;
    storeName: string;
    lines: LineSpec[];
    fulfilment: 'delivery' | 'pickup';
    respondBy?: number;
  },
): Promise<PlacedFixture> {
  const now = ctx.clock.now();
  orderSerial += 1;
  const orderId = randomUUID();
  const number = `IS-${orderSerial}`;
  const storeOrderId = `${orderId}-A`;
  const placed = amounts(input.lines);
  const deliverBy = now + 85 * MINUTE;
  const readyBy = now + 40 * MINUTE;
  const delivery = input.fulfilment === 'delivery';
  const deliveryId = delivery ? randomUUID() : null;
  const lines: StoreOrderLine[] = input.lines.map((l, index) => ({
    lineId: `L${index + 1}`,
    kind: 'catalog',
    productId: l.productId,
    sku: null,
    name: l.name,
    brand: null,
    unit: 'each',
    size: null,
    categoryId: 'fasteners',
    imageKey: null,
    imageUrl: null,
    unitPriceCents: l.unitPriceCents,
    quantity: l.quantity,
    fulfilledQty: l.quantity,
    shortReason: null,
    lineCents: l.unitPriceCents * l.quantity,
    discountCents: l.discountCents,
    weightKg: 0.5,
    dimsCm: { l: 18, w: 5, h: 5 },
    note: null,
  }));
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const window = delivery
    ? {
        id: 'asap',
        kind: 'asap' as const,
        date: '2026-11-19',
        startAt: null,
        endAt: deliverBy,
        label: 'Today by 1:50 pm',
      }
    : null;
  const so: StoreOrder = {
    id: storeOrderId,
    number: `${number}-A`,
    letter: 'A',
    orderId,
    orderNumber: number,
    source: 'cart',
    storeId: input.storeId,
    storeName: input.storeName,
    storeAddressLine: 'Dixon Rd & Martin Grove Rd, Toronto',
    storeLocation: { lat: 43.6966, lng: -79.5752 },
    storePhone: '+14165550120',
    customerId: input.customer.uid,
    customerName: input.customer.account.displayName,
    companyName: null,
    customerPhone: '+14165550199',
    fulfilment: input.fulfilment,
    jobsite: delivery ? JOBSITE : null,
    receiving: delivery ? 'attended' : null,
    siteContact: delivery ? { name: 'Site Contact', phone: '+14165550110' } : null,
    instructions: null,
    window,
    timing: {
      respondBy: input.respondBy ?? now + 10 * MINUTE,
      readyBy,
      readyByDate: '2026-11-19',
      targetPickupAt: delivery ? readyBy : null,
      deliverBy: delivery ? deliverBy : null,
    },
    lines,
    lineCount: lines.length,
    itemCount,
    itemsSummary: LOAD.summary,
    load: LOAD,
    vehicleClass: delivery ? 'car' : null,
    roadKm: delivery ? 38.9 : null,
    unload: { offered: false, required: false, selected: false, feeCents: 0 },
    deliveryFeeListCents: 0,
    feeWaiver: null,
    placed,
    current: placed,
    storeValueCents: placed.itemsCents,
    status: 'new',
    statusAt: { new: now },
    version: 0,
    history: [
      {
        status: 'new',
        at: now,
        actorId: input.customer.uid,
        actorName: null,
        actorRole: 'customer',
        note: null,
      },
    ],
    deliveryId,
    driver: null,
    driverSyncedAt: null,
    pickup: { readyAt: null, holdUntil: null, collectedAt: null, collectedBy: null },
    rejectReason: null,
    cancelReason: null,
    cancelledBy: null,
    reminderSentAt: null,
    acceptOverdue: false,
    issueCount: 0,
    rated: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const trackingToken = delivery ? newTrackingToken() : null;
  const order: Order = {
    id: orderId,
    number,
    source: 'cart',
    quoteId: null,
    issueId: null,
    customerId: input.customer.uid,
    customerName: so.customerName,
    companyName: null,
    customerPhone: so.customerPhone,
    fulfilment: input.fulfilment,
    jobsite: so.jobsite,
    receiving: so.receiving,
    siteContact: so.siteContact,
    window,
    instructions: null,
    storeOrderIds: [storeOrderId],
    storeCount: 1,
    lineCount: lines.length,
    itemCount,
    itemsSummary: so.itemsSummary,
    placed: { ...placed, discounts: [], promoCode: null, freeDelivery: null },
    current: placed,
    payment: {
      method: 'card',
      provider: 'test',
      intentRef: `test_pi_${orderId}`,
      card: { cardId: randomUUID(), brand: 'visa', last4: '4242' },
      status: 'authorized',
      authorizedCents: placed.totalCents,
      capturedCents: 0,
      refundedCents: 0,
      pendingCaptureCents: 0,
      capturedByStoreOrder: {},
      refundedByStoreOrder: {},
      adjustedByStoreOrder: {},
      authorizedAt: now,
      captureDeadlineAt: now + 6 * 24 * 60 * MINUTE,
      capturedAt: null,
      events: [],
    },
    storeOrders: [
      {
        storeOrderId,
        number: so.number,
        letter: 'A',
        storeId: input.storeId,
        storeName: input.storeName,
        fulfilment: input.fulfilment,
        status: 'new',
        itemCount,
        itemsSummary: so.itemsSummary,
        currentTotalCents: placed.totalCents,
        deliverBy: so.timing.deliverBy,
        readyAt: null,
        holdUntil: null,
        trackingToken,
        pickupCode: null,
        driverFirstName: null,
        updatedAt: now,
      },
    ],
    status: 'placed',
    statusAt: { placed: now },
    needsAttention: false,
    isFirstOrder: false,
    countsTowardFirstOrder: true,
    hstNumber: null,
    cancelReason: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const meta: StoreOrderPrivateMeta = {
    pickupCode: null,
    pickupCodeIssuedTo: null,
    codeAttempts: 0,
    commissionBps: 1000,
    alertSmsSentAt: null,
  };

  await withTransaction(ctx.deps, async (tx) => {
    const { id: _o, createdAt: _oc, updatedAt: _ou, ...orderDoc } = order;
    await tx.query(`INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`, [
      orderId,
      JSON.stringify(orderDoc),
      new Date(now),
    ]);
    const { id: _s, createdAt: _sc, updatedAt: _su, ...soDoc } = so;
    await tx.query(
      `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $4)`,
      [storeOrderId, JSON.stringify(soDoc), JSON.stringify(meta), new Date(now)],
    );
    if (!delivery) {
      const pin = await stagePickupCode(tx, storeOrderId, 'customer');
      await tx.query(
        `UPDATE orders SET doc = jsonb_set(doc, '{storeOrders,0,pickupCode}', to_jsonb($2::text)) WHERE id = $1`,
        [orderId, pin],
      );
    }
    for (const line of input.lines) {
      await tx.query('UPDATE products SET reserved = reserved + $2 WHERE id = $1', [
        line.productId,
        line.quantity,
      ]);
    }
    if (deliveryId) {
      const d: Omit<Delivery, 'id' | 'createdAt' | 'updatedAt'> = {
        kind: 'marketplace',
        storeOrderId,
        storeId: input.storeId,
        pickup: {
          storeId: input.storeId,
          storeName: input.storeName,
          address: so.storeAddressLine,
          location: so.storeLocation,
          phone: so.storePhone,
          loadingNotes: null,
          readyBy,
          ready: false,
          readyAt: null,
          arrivedAt: null,
          collectedAt: null,
          pickupCode: null,
        },
        load: LOAD,
        vehicleClass: 'car',
        tripKm: 38.9,
        cityIds: ['toronto'],
        receiving: 'attended',
        requirePhoto: true,
        unload: {
          labourer: false,
          required: false,
          status: 'not_needed',
          labourerName: null,
          labourerPhone: null,
        },
        payout: {
          offerCents: 3825,
          baseCents: 900,
          distanceCents: 2918,
          loadCents: 0,
          handlingCents: 0,
          boostCents: 0,
          waitCents: 0,
          totalCents: 3825,
        },
        offerStatus: 'held',
        offerOpensAt: null,
        releasedBy: {},
        orderId: so.number,
        customer: { name: 'Site Contact', phone: '+14165550110' },
        address: JOBSITE.addressLine,
        location: JOBSITE.location,
        addressNotes: null,
        notes: null,
        packageCount: itemCount,
        priority: 'high',
        requireCode: true,
        windowStart: null,
        windowEnd: deliverBy,
        driverId: null,
        driverName: null,
        status: 'unassigned',
        attempts: 0,
        declinedBy: [],
        sourceOrderId: orderId,
        customerId: input.customer.uid,
        proof: null,
        failure: null,
        createdBy: input.customer.uid,
        updatedBy: null,
      };
      const dmeta: DeliveryPrivateMeta & { codeAttempts: number } = {
        trackingToken: trackingToken!,
        handoffCode: '7314',
        codeAttempts: 0,
      };
      await tx.query(
        `INSERT INTO deliveries (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $4)`,
        [deliveryId, JSON.stringify(d), JSON.stringify(dmeta), new Date(now)],
      );
    }
  });
  return { orderId, storeOrderId, deliveryId, number: so.number };
}

/** What claimJob leaves behind: the delivery accepted by the driver, with a new PIN issued to them. */
async function claimFor(ctx: TestContext, placed: PlacedFixture, driver: ActorClient): Promise<string> {
  return withTransaction(ctx.deps, async (tx) => {
    await lockGraph(tx, { deliveryIds: [placed.deliveryId!], userIds: [driver.uid], withOffers: true });
    const pin = await stagePickupCode(tx, placed.storeOrderId, driver.uid);
    await tx.query(`UPDATE deliveries SET doc = doc || $2::jsonb, updated_at = $3 WHERE id = $1`, [
      placed.deliveryId,
      JSON.stringify({
        status: 'accepted',
        driverId: driver.uid,
        driverName: driver.account.displayName,
        offerStatus: 'claimed',
        acceptedAt: tx.now,
      }),
      new Date(tx.now),
    ]);
    await tx.query(
      `UPDATE deliveries SET doc = jsonb_set(doc, '{pickup,pickupCode}', to_jsonb($2::text)) WHERE id = $1`,
      [placed.deliveryId, pin],
    );
    await tx.query('DELETE FROM job_offers WHERE delivery_id = $1', [placed.deliveryId]);
    return pin;
  });
}

/**
 * The release of MARKETPLACE §2.3 as the rows show it (accepted → unassigned, driver and PIN cleared), in a
 * transaction that takes the same locks as every delivery writer (lockGraph from the delivery).
 */
async function releaseFor(ctx: TestContext, placed: PlacedFixture): Promise<'released' | 'too_late'> {
  return withTransaction(ctx.deps, async (tx) => {
    const graph = await lockGraph(tx, { deliveryIds: [placed.deliveryId!], withOffers: true });
    const row = graph.deliveries.get(placed.deliveryId!)!;
    if (row.status !== 'accepted') return 'too_late';
    await tx.query(
      `UPDATE deliveries SET doc = jsonb_set(doc || $2::jsonb, '{pickup,pickupCode}', 'null'), updated_at = $3 WHERE id = $1`,
      [
        placed.deliveryId,
        JSON.stringify({ status: 'unassigned', driverId: null, driverName: null, offerStatus: 'open' }),
        new Date(tx.now),
      ],
    );
    return 'released';
  });
}

async function storeOrderRow(ctx: TestContext, id: string): Promise<StoreOrder> {
  const { rows } = await ctx.pool.query<{
    doc: Omit<StoreOrder, 'id'>;
    created_at: number;
    updated_at: number;
  }>('SELECT doc, created_at, updated_at FROM store_orders WHERE id = $1', [id]);
  const row = rows[0]!;
  return { ...row.doc, id, createdAt: row.created_at, updatedAt: row.updated_at } as StoreOrder;
}

async function metaOf(ctx: TestContext, id: string): Promise<StoreOrderPrivateMeta> {
  const { rows } = await ctx.pool.query<{ meta: StoreOrderPrivateMeta }>(
    'SELECT meta FROM store_orders WHERE id = $1',
    [id],
  );
  return rows[0]!.meta;
}

async function deliveryRow(ctx: TestContext, id: string): Promise<Delivery> {
  const { rows } = await ctx.pool.query<{ doc: Omit<Delivery, 'id'> }>(
    'SELECT doc FROM deliveries WHERE id = $1',
    [id],
  );
  return { ...rows[0]!.doc, id } as Delivery;
}

async function stock(ctx: TestContext, productId: string): Promise<{ onHand: number; reserved: number }> {
  const { rows } = await ctx.pool.query<{ stock_on_hand: number; reserved: number }>(
    'SELECT stock_on_hand, reserved FROM products WHERE id = $1',
    [productId],
  );
  return { onHand: rows[0]!.stock_on_hand, reserved: rows[0]!.reserved };
}

async function offerCount(ctx: TestContext, deliveryId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM job_offers WHERE delivery_id = $1',
    [deliveryId],
  );
  return rows[0]!.n;
}

async function notificationsOf(ctx: TestContext, uid: string): Promise<AppNotification[]> {
  const { rows } = await ctx.pool.query<AppNotification & { dedupe_key: string }>(
    `SELECT id, user_id AS "userId", type, title, body, data, dedupe_key FROM notifications WHERE user_id = $1 ORDER BY created_at, id`,
    [uid],
  );
  return rows;
}

// ---------- the workflow ----------

describe('store-order workflow (MARKETPLACE §2.1, §5.5.2, §5.7 → PLATFORM §9.2.2, §9.2.4, §9.5)', () => {
  let ctx: TestContext;
  let owner: ActorClient & { storeId: string };
  let storeStaff: ActorClient & { storeId: string };
  let otherOwner: ActorClient & { storeId: string };
  let staff: ActorClient;
  let customer: ActorClient;
  let otherCustomer: ActorClient;
  let driver: ActorClient;
  let otherDriver: ActorClient;
  const storeName = 'Boltbin Fasteners';
  let storeId: string;

  /** V3's Boltbin store order: 24 joist hangers @ 2.79 (discount 215) and 2 deck screws @ 34.98 (224). */
  async function boltbin(fulfilment: 'delivery' | 'pickup' = 'delivery', respondBy?: number) {
    const hangers = await createProduct(ctx, storeId, {
      name: 'Joist hanger 2x8',
      priceCents: 279,
      stockOnHand: 30,
      categoryId: 'fasteners',
    });
    const screws = await createProduct(ctx, storeId, {
      name: 'Deck screws 5 lb',
      priceCents: 3498,
      stockOnHand: 10,
      categoryId: 'fasteners',
    });
    const placed = await placeFixture(ctx, {
      customer,
      storeId,
      storeName,
      fulfilment,
      respondBy,
      lines: [
        {
          productId: hangers.id,
          name: 'Joist hanger 2x8',
          unitPriceCents: 279,
          quantity: 24,
          discountCents: 215,
        },
        {
          productId: screws.id,
          name: 'Deck screws 5 lb',
          unitPriceCents: 3498,
          quantity: 2,
          discountCents: 224,
        },
      ],
    });
    return { ...placed, hangers: hangers.id, screws: screws.id };
  }

  const accept = (
    actor: ActorClient,
    id: string,
    expectedVersion: number,
    extra: Record<string, unknown> = {},
  ) =>
    actor.call<StoreOrderActionResponse>('acceptStoreOrder', { storeOrderId: id, expectedVersion, ...extra });
  const markReady = (
    actor: ActorClient,
    id: string,
    expectedVersion: number,
    extra: Record<string, unknown> = {},
  ) =>
    actor.call<StoreOrderActionResponse>('updateStoreOrderStatus', {
      storeOrderId: id,
      expectedVersion,
      status: 'ready',
      ...extra,
    });
  const pickupWith = (
    actor: ActorClient,
    id: string,
    expectedVersion: number,
    pickupCode: string | null,
    extra: Record<string, unknown> = {},
  ) =>
    actor.call<{ status: string }>('completePickup', {
      storeOrderId: id,
      expectedVersion,
      pickupCode,
      ...extra,
    });

  before(async () => {
    ctx = await createTestContext();
    const store = await createStore(ctx, { name: storeName, categoryIds: ['fasteners'] });
    storeId = store.id;
    owner = await newSupplier(ctx, { storeId, storeRole: 'owner', displayName: 'Owen Malik' });
    storeStaff = await newSupplier(ctx, { storeId, storeRole: 'staff', displayName: 'Sara Staff' });
    otherOwner = await newSupplier(ctx, { displayName: 'Other Owner' });
    staff = await newDispatcher(ctx, { displayName: 'Dee Dispatcher' });
    customer = await newCustomer(ctx, { displayName: 'Dana Whitfield' });
    otherCustomer = await newCustomer(ctx, { displayName: 'Sam Ortega' });
    driver = await newDriver(ctx, {
      displayName: 'Marco Rossi',
      capacityClass: 'pickup',
      vehicle: { capacityClass: 'pickup', make: 'Ford', model: 'F-150', plate: 'CBKX 214' },
    });
    otherDriver = await newDriver(ctx, { displayName: 'Devon Clarke', capacityClass: 'pickup' });
  });
  after(() => ctx.close());

  test('accept with a shortage (V4): current, reserved, stock clamp, customer message, job offer', async () => {
    const placed = await boltbin();
    const answer = await expectOk(
      accept(owner, placed.storeOrderId, 0, {
        adjustments: [{ lineId: 'L1', fulfilledQty: 20, reason: 'out_of_stock' }],
      }),
    );
    assert.deepEqual(answer, { status: 'accepted', version: 1 });

    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.placed.totalCents, 14_976);
    assert.deepEqual(so.current, {
      itemsCents: 12_576,
      discountCents: 403,
      deliveryFeeCents: 0,
      unloadFeeCents: 0,
      taxCents: 1_582,
      totalCents: 13_755,
    });
    assert.equal(so.storeValueCents, 12_576);
    assert.equal(so.lines[0]!.fulfilledQty, 20);
    assert.equal(so.lines[0]!.shortReason, 'out_of_stock');
    assert.equal(so.history.at(-1)!.actorRole, 'supplier');
    assert.match(so.history.at(-1)!.note ?? '', /20 of 24 Joist hanger 2x8 — out of stock/);

    // reserved −= 4, and on hand clamped to what stays reserved (available 0); the screws are untouched.
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 20, reserved: 20 });
    assert.deepEqual(await stock(ctx, placed.screws), { onHand: 10, reserved: 2 });

    const messages = (await notificationsOf(ctx, customer.uid)).filter(
      (n) => n.data.storeOrderId === placed.storeOrderId,
    );
    const confirmed = messages.find((n) => n.type === 'order_store_update');
    assert.ok(confirmed, 'the customer is told');
    assert.match(confirmed.body, /20 of 24 Joist hanger 2x8 in stock — you won't be charged for 4/);

    // ASAP: the offer opens at once (targetPickupAt − 12 h is in the past).
    const delivery = await deliveryRow(ctx, placed.deliveryId!);
    assert.equal(delivery.offerStatus, 'open');
    assert.equal(delivery.offerOpensAt, REFERENCE_TIME);
    assert.equal(await offerCount(ctx, placed.deliveryId!), 1);

    // The order follows (projectOrderAggregate).
    const { rows } = await ctx.pool.query<{ status: string; total: number }>(
      `SELECT status, (doc #>> '{current,totalCents}')::int AS total FROM orders WHERE id = $1`,
      [placed.orderId],
    );
    assert.deepEqual(rows[0], { status: 'confirmed', total: 13_755 });
  });

  test('accept: stale version, wrong store, customer, unknown order, quantities only go down', async () => {
    const placed = await boltbin();
    await expectError(accept(owner, placed.storeOrderId, 3), 'failed-precondition', 'VERSION_CONFLICT');
    await expectError(accept(otherOwner, placed.storeOrderId, 0), 'permission-denied');
    await expectError(accept(customer, placed.storeOrderId, 0), 'permission-denied');
    await expectError(accept(driver, placed.storeOrderId, 0), 'permission-denied');
    await expectError(accept(owner, `${randomUUID()}-A`, 0), 'not-found');
    await expectError(
      accept(owner, placed.storeOrderId, 0, {
        adjustments: [{ lineId: 'L1', fulfilledQty: 25, reason: 'other' }],
      }),
      'invalid-argument',
    );
    await expectError(
      accept(owner, placed.storeOrderId, 0, {
        adjustments: [{ lineId: 'L9', fulfilledQty: 1, reason: 'other' }],
      }),
      'invalid-argument',
    );
    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'new');
    assert.equal(so.version, 0);
    // Staff may accept any store's order.
    assert.deepEqual(await expectOk(accept(staff, placed.storeOrderId, 0)), {
      status: 'accepted',
      version: 1,
    });
  });

  test('shorting every line to 0 at accept is a reject with reason out_of_stock', async () => {
    const placed = await boltbin();
    const answer = await expectOk(
      accept(owner, placed.storeOrderId, 0, {
        adjustments: [
          { lineId: 'L1', fulfilledQty: 0, reason: 'out_of_stock' },
          { lineId: 'L2', fulfilledQty: 0, reason: 'discontinued' },
        ],
      }),
    );
    assert.equal(answer.status, 'rejected');
    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.rejectReason, 'out_of_stock');
    assert.equal(so.current.totalCents, 0);
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 0, reserved: 0 });
    assert.deepEqual(await stock(ctx, placed.screws), { onHand: 10, reserved: 0 });
    assert.equal((await deliveryRow(ctx, placed.deliveryId!)).status, 'cancelled');
  });

  test('reject cascade: delivery cancelled, offer deleted, stock released, customer not charged', async () => {
    const placed = await boltbin();
    await expectOk(accept(owner, placed.storeOrderId, 0));
    assert.equal(await offerCount(ctx, placed.deliveryId!), 1);

    await expectError(
      owner.call('rejectStoreOrder', {
        storeOrderId: placed.storeOrderId,
        expectedVersion: 1,
        reason: 'no_response',
      }),
      'invalid-argument',
    );
    const answer = await expectOk(
      owner.call<StoreOrderActionResponse>('rejectStoreOrder', {
        storeOrderId: placed.storeOrderId,
        expectedVersion: 1,
        reason: 'cannot_meet_time',
        note: 'Truck broke down',
      }),
    );
    // From accepted the store cancels (MARKETPLACE §2.1).
    assert.deepEqual(answer, { status: 'cancelled', version: 2 });
    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.cancelledBy, 'store');
    assert.equal(so.rejectReason, 'cannot_meet_time');
    assert.equal(so.current.totalCents, 0);
    assert.equal(so.storeValueCents, 0);

    const delivery = await deliveryRow(ctx, placed.deliveryId!);
    assert.equal(delivery.status, 'cancelled');
    assert.equal(delivery.offerStatus, 'withdrawn');
    assert.equal(await offerCount(ctx, placed.deliveryId!), 0);
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 30, reserved: 0 });
    assert.deepEqual(await stock(ctx, placed.screws), { onHand: 10, reserved: 0 });

    const message = (await notificationsOf(ctx, customer.uid)).find(
      (n) =>
        n.data.storeOrderId === placed.storeOrderId &&
        (n.type === 'order_cancelled' || n.type === 'order_store_update') &&
        /won't be charged/.test(n.body),
    );
    assert.ok(message);
    assert.match(message.body, /\$149\.76/);
    assert.equal(message.type, 'order_cancelled', 'the only store order: the whole order ends cancelled');

    // A final store order cannot be rejected again.
    await expectError(
      owner.call('rejectStoreOrder', {
        storeOrderId: placed.storeOrderId,
        expectedVersion: 2,
        reason: 'other',
      }),
      'failed-precondition',
    );
  });

  test('ready gating: no ready before accept, no hand-over before ready; ready ↔ preparing on delivery and offer', async () => {
    const placed = await boltbin();
    await expectError(markReady(owner, placed.storeOrderId, 0), 'failed-precondition');
    await expectOk(accept(owner, placed.storeOrderId, 0));
    await expectError(
      pickupWith(owner, placed.storeOrderId, 1, '0000'),
      'failed-precondition',
      'STORE_NOT_READY',
    );

    await expectOk(
      owner.call('updateStoreOrderStatus', {
        storeOrderId: placed.storeOrderId,
        expectedVersion: 1,
        status: 'preparing',
      }),
    );
    assert.deepEqual(await expectOk(markReady(owner, placed.storeOrderId, 2)), {
      status: 'ready',
      version: 3,
    });
    let so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.pickup.readyAt, REFERENCE_TIME);
    let delivery = await deliveryRow(ctx, placed.deliveryId!);
    assert.equal(delivery.pickup!.ready, true);
    assert.equal(delivery.pickup!.readyAt, REFERENCE_TIME);
    const offer = await ctx.pool.query<{ ready: boolean }>(
      `SELECT (doc #>> '{pickup,ready}')::boolean AS ready FROM job_offers WHERE delivery_id = $1`,
      [placed.deliveryId],
    );
    assert.equal(offer.rows[0]!.ready, true);

    // "Not ready after all".
    await expectOk(
      owner.call('updateStoreOrderStatus', {
        storeOrderId: placed.storeOrderId,
        expectedVersion: 3,
        status: 'preparing',
      }),
    );
    so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'preparing');
    delivery = await deliveryRow(ctx, placed.deliveryId!);
    assert.equal(delivery.pickup!.ready, false);
    const back = await ctx.pool.query<{ ready: boolean }>(
      `SELECT (doc #>> '{pickup,ready}')::boolean AS ready FROM job_offers WHERE delivery_id = $1`,
      [placed.deliveryId],
    );
    assert.equal(back.rows[0]!.ready, false);
  });

  test('wrong PIN ×5 → CODE_LOCKED; a wrong PIN saves nothing but the attempt; staff override', async () => {
    const placed = await boltbin('pickup');
    await expectOk(accept(owner, placed.storeOrderId, 0));
    await expectOk(markReady(owner, placed.storeOrderId, 1));
    const meta = await metaOf(ctx, placed.storeOrderId);
    assert.equal(meta.pickupCodeIssuedTo, 'customer');
    const wrong = meta.pickupCode === '0000' ? '1111' : '0000';

    // A wrong PIN with an adjustment: only the attempt is saved.
    const first = await expectError(
      pickupWith(owner, placed.storeOrderId, 2, wrong, {
        adjustments: [{ lineId: 'L1', fulfilledQty: 10, reason: 'damaged' }],
      }),
      'invalid-argument',
      'CODE_INCORRECT',
    );
    assert.equal(first.details.remaining, 4);
    let so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.version, 2);
    assert.equal(so.lines[0]!.fulfilledQty, 24);
    assert.equal((await metaOf(ctx, placed.storeOrderId)).codeAttempts, 1);
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 30, reserved: 24 });

    for (const remaining of [3, 2, 1, 0]) {
      const answer = await expectError(
        pickupWith(storeStaff, placed.storeOrderId, 2, wrong),
        'invalid-argument',
        'CODE_INCORRECT',
      );
      assert.equal(answer.details.remaining, remaining);
    }
    // Locked: even the right PIN is refused now.
    await expectError(
      pickupWith(owner, placed.storeOrderId, 2, meta.pickupCode),
      'resource-exhausted',
      'CODE_LOCKED',
    );
    // Only staff can complete, and only staff may override.
    await expectError(
      pickupWith(owner, placed.storeOrderId, 2, null, { overrideReason: 'Customer showed ID' }),
      'permission-denied',
    );
    assert.deepEqual(
      await expectOk(
        pickupWith(staff, placed.storeOrderId, 2, null, {
          overrideReason: 'Customer showed ID at the counter',
        }),
      ),
      { status: 'picked_up' },
    );
    so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'picked_up');
    assert.match(so.history.at(-1)!.note ?? '', /Customer showed ID at the counter/);
    assert.equal((await metaOf(ctx, placed.storeOrderId)).codeAttempts, 0);
  });

  test('customer pickup with the PIN: picked up, completedAt, stock committed, customer told', async () => {
    const placed = await boltbin('pickup');
    await expectOk(accept(owner, placed.storeOrderId, 0));
    await expectOk(markReady(owner, placed.storeOrderId, 1));
    let so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.ok(
      so.pickup.holdUntil !== null && so.pickup.holdUntil > REFERENCE_TIME,
      'a hold until the next closing time',
    );
    const pin = (await metaOf(ctx, placed.storeOrderId)).pickupCode!;
    const ready = (await notificationsOf(ctx, customer.uid)).find(
      (n) => n.type === 'pickup_ready' && n.data.storeOrderId === placed.storeOrderId,
    );
    assert.ok(ready);
    assert.match(ready.body, new RegExp(`show PIN ${pin}`));

    ctx.clock.advance(5 * MINUTE);
    assert.deepEqual(
      await expectOk(
        pickupWith(storeStaff, placed.storeOrderId, 2, pin, {
          adjustments: [{ lineId: 'L2', fulfilledQty: 1, reason: 'damaged' }],
        }),
      ),
      { status: 'picked_up' },
    );
    so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'picked_up');
    assert.equal(so.completedAt, REFERENCE_TIME + 5 * MINUTE);
    assert.equal(so.pickup.collectedBy, 'customer');
    assert.equal(so.version, 3);
    // Screws: one released by the shortage, one committed; hangers: 24 committed.
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 6, reserved: 0 });
    assert.deepEqual(await stock(ctx, placed.screws), { onHand: 9, reserved: 0 });
    assert.ok(
      (await notificationsOf(ctx, customer.uid)).some(
        (n) => n.data.storeOrderId === placed.storeOrderId && /Picked up at/.test(n.body),
      ),
    );
    ctx.clock.set(REFERENCE_TIME);
  });

  test('driver hand-over: the PIN of the assigned driver only; delivery picked up with wait pay', async () => {
    const placed = await boltbin();
    await expectOk(accept(owner, placed.storeOrderId, 0));
    // Not claimed yet.
    await expectOk(markReady(owner, placed.storeOrderId, 1));
    await expectError(
      pickupWith(owner, placed.storeOrderId, 2, '1234'),
      'failed-precondition',
      'DRIVER_NOT_ASSIGNED',
    );

    const pin = await claimFor(ctx, placed, driver);
    // Ready-by 40 minutes ago, the driver checked in 10 minutes before it, collected now:
    // 40 minutes of waiting, 25 after the grace → 25 × 25 = 625. (The clock stays: tokens would expire.)
    const readyBy = REFERENCE_TIME - 40 * MINUTE;
    await ctx.pool.query(
      `UPDATE deliveries SET doc = jsonb_set(jsonb_set(doc, '{pickup,readyBy}', to_jsonb($2::bigint)),
                                             '{pickup,arrivedAt}', to_jsonb($3::bigint)) WHERE id = $1`,
      [placed.deliveryId, readyBy, readyBy - 10 * MINUTE],
    );
    assert.deepEqual(await expectOk(pickupWith(owner, placed.storeOrderId, 2, pin)), {
      status: 'out_for_delivery',
    });

    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'out_for_delivery');
    assert.equal(so.pickup.collectedBy, 'driver');
    assert.equal(so.completedAt, null);
    const delivery = await deliveryRow(ctx, placed.deliveryId!);
    assert.equal(delivery.status, 'picked_up');
    assert.equal(delivery.pickedUpAt, REFERENCE_TIME);
    assert.equal(delivery.pickup!.collectedAt, REFERENCE_TIME);
    assert.equal(delivery.payout!.waitCents, 625);
    assert.equal(delivery.payout!.totalCents, 3825 + 625);
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 6, reserved: 0 });
    const events = await ctx.pool.query<{ message: string; actor_role: string }>(
      `SELECT doc->>'message' AS message, doc->>'actorRole' AS actor_role FROM delivery_events
        WHERE delivery_id = $1 AND doc->>'status' = 'picked_up'`,
      [placed.deliveryId],
    );
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0]!.actor_role, 'supplier');
    assert.match(events.rows[0]!.message, /Collected at Boltbin Fasteners — PIN checked by Owen Malik/);
  });

  test("a released driver's PIN never works (pickupCodeIssuedTo)", async () => {
    const placed = await boltbin();
    await expectOk(accept(owner, placed.storeOrderId, 0));
    await expectOk(markReady(owner, placed.storeOrderId, 1));
    const oldPin = await claimFor(ctx, placed, driver);
    await releaseFor(ctx, placed);
    await claimFor(ctx, placed, otherDriver);
    // The PIN on the meta is now otherDriver's; simulate a stale issuer to prove the check.
    await ctx.pool.query(`UPDATE store_orders SET meta = meta || $2::jsonb WHERE id = $1`, [
      placed.storeOrderId,
      JSON.stringify({ pickupCode: oldPin, pickupCodeIssuedTo: driver.uid }),
    ]);
    await expectError(
      pickupWith(owner, placed.storeOrderId, 2, oldPin),
      'failed-precondition',
      'DRIVER_NOT_ASSIGNED',
    );
  });

  test('hold expiry through runJob: not collected → cancelled by the system, stock released, not charged', async () => {
    const placed = await boltbin('pickup');
    await expectOk(accept(owner, placed.storeOrderId, 0));
    await expectOk(markReady(owner, placed.storeOrderId, 1));
    const holdUntil = (await storeOrderRow(ctx, placed.storeOrderId)).pickup.holdUntil!;

    assert.equal((await ctx.runJob('expirePickupHolds', holdUntil - MINUTE)).expired, 0);
    const result = await ctx.runJob('expirePickupHolds', holdUntil + MINUTE);
    assert.ok((result.expired ?? 0) >= 1);
    assert.equal(result.errors, 0);
    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'cancelled');
    assert.equal(so.cancelledBy, 'system');
    assert.equal(so.current.totalCents, 0);
    assert.equal(so.history.at(-1)!.actorRole, 'system');
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 30, reserved: 0 });
    const told = (await notificationsOf(ctx, customer.uid)).find(
      (n) => n.data.storeOrderId === placed.storeOrderId && /wasn't collected/.test(n.body),
    );
    assert.ok(told);
    assert.match(told.body, /won't be charged \$149\.76/);
    // A second run finds nothing.
    assert.equal((await ctx.runJob('expirePickupHolds', holdUntil + 2 * MINUTE)).expired, 0);
  });

  test('reminder → overdue → auto-reject through runJob', async () => {
    const respondBy = REFERENCE_TIME + 10 * MINUTE;
    const placed = await boltbin('delivery', respondBy);
    const run = (at: number) => ctx.runJob('escalateStoreOrders', at);

    assert.deepEqual(await run(respondBy - 6 * MINUTE), { reminded: 0, overdue: 0, rejected: 0, errors: 0 });
    const reminded = await run(respondBy - 5 * MINUTE);
    assert.equal(reminded.reminded, 1);
    assert.equal((await run(respondBy - 4 * MINUTE)).reminded, 0, 'once');
    let so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.reminderSentAt, respondBy - 5 * MINUTE);
    assert.equal(so.version, 0, 'no version bump');
    const ownerInbox = await notificationsOf(ctx, owner.uid);
    assert.ok(
      ownerInbox.some(
        (n) => n.type === 'store_order_reminder' && n.data.storeOrderId === placed.storeOrderId,
      ),
    );
    const sms = (await outboxEvents(ctx, 'sms.send')).filter((e) =>
      String(e.payload.body).includes(placed.number),
    );
    assert.ok(
      sms.some((e) => /is waiting/.test(String(e.payload.body)) && e.payload.purpose === 'store_alert'),
    );

    const overdue = await run(respondBy);
    assert.equal(overdue.overdue, 1);
    so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.acceptOverdue, true);
    assert.ok(
      (await notificationsOf(ctx, staff.uid)).some(
        (n) => n.type === 'store_order_late' && n.data.storeOrderId === placed.storeOrderId,
      ),
    );
    const attention = await ctx.pool.query<{ needs: boolean }>(
      'SELECT needs_attention AS needs FROM orders WHERE id = $1',
      [placed.orderId],
    );
    assert.equal(attention.rows[0]!.needs, true);

    assert.equal((await run(respondBy + 19 * MINUTE)).rejected, 0);
    const rejected = await run(respondBy + 20 * MINUTE);
    assert.equal(rejected.rejected, 1);
    assert.equal(rejected.errors, 0);
    so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'rejected');
    assert.equal(so.rejectReason, 'no_response');
    assert.equal(so.history.at(-1)!.actorRole, 'system');
    assert.equal((await deliveryRow(ctx, placed.deliveryId!)).status, 'cancelled');
    assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 30, reserved: 0 });
  });

  test('GET /store-orders: suppliers are scoped to their store, customers to their own order, the PIN never shows', async () => {
    const placed = await boltbin('pickup');
    const list = await expectOk(owner.get<Page<StoreOrder>>('/store-orders?status=new&sort=readyBy:asc'));
    assert.ok(list.items.length >= 1);
    assert.ok(list.items.every((so) => so.storeId === storeId && so.status === 'new'));
    await expectError(owner.get(`/store-orders?storeId=${otherOwner.storeId}`), 'permission-denied');
    const otherList = await expectOk(otherOwner.get<Page<StoreOrder>>('/store-orders'));
    assert.equal(otherList.items.length, 0);

    const mine = await expectOk(customer.get<Page<StoreOrder>>(`/store-orders?orderId=${placed.orderId}`));
    assert.deepEqual(
      mine.items.map((so) => so.id),
      [placed.storeOrderId],
    );
    await expectError(customer.get('/store-orders'), 'invalid-argument');
    await expectError(otherCustomer.get(`/store-orders?orderId=${placed.orderId}`), 'permission-denied');
    await expectError(driver.get('/store-orders'), 'permission-denied');
    await expectError(owner.get('/store-orders?sort=readyBy:asc&storeId=nope'), 'permission-denied');
    await expectError(staff.get('/store-orders?sort=readyBy:asc'), 'invalid-argument');

    const one = await expectOk(customer.get<StoreOrder>(`/store-orders/${placed.storeOrderId}`));
    const pin = (await metaOf(ctx, placed.storeOrderId)).pickupCode!;
    assert.ok(!JSON.stringify(one).includes(`"pickupCode"`));
    assert.ok(!('meta' in one));
    await expectOk(owner.get(`/store-orders/${placed.storeOrderId}`));
    await expectError(otherOwner.get(`/store-orders/${placed.storeOrderId}`), 'permission-denied');
    await expectError(otherCustomer.get(`/store-orders/${placed.storeOrderId}`), 'permission-denied');
    await expectError(driver.get(`/store-orders/${placed.storeOrderId}`), 'permission-denied');

    const meta = await expectOk(
      staff.get<StoreOrderPrivateMeta>(`/store-orders/${placed.storeOrderId}/private`),
    );
    assert.equal(meta.pickupCode, pin);
    await expectError(owner.get(`/store-orders/${placed.storeOrderId}/private`), 'permission-denied');
    await expectError(customer.get(`/store-orders/${placed.storeOrderId}/private`), 'permission-denied');

    const proof = await expectOk(
      customer.get<{ photoUrl: string | null }>(`/store-orders/${placed.storeOrderId}/proof`),
    );
    assert.equal(proof.photoUrl, null);
    await expectError(owner.get(`/store-orders/${placed.storeOrderId}/proof`), 'permission-denied');

    // Keyset pages neither skip nor repeat.
    const page1 = await expectOk(staff.get<Page<StoreOrder>>('/store-orders?limit=2'));
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = await expectOk(
      staff.get<Page<StoreOrder>>(`/store-orders?limit=2&cursor=${page1.nextCursor}`),
    );
    for (const so of page2.items) assert.ok(!page1.items.some((seen) => seen.id === so.id));
  });

  // ---------- concurrency (§12.3) ----------

  test('accept twice: two store members accept at once → one accepted, one VERSION_CONFLICT, one job offer', async () => {
    await race({
      times: 25,
      setup: () => boltbin(),
      run: (placed) => [
        () => accept(owner, placed.storeOrderId, 0),
        () => accept(storeStaff, placed.storeOrderId, 0),
      ],
      check: async (answers, placed) => {
        const ok = answers.filter((a) => a.status === 200);
        assert.equal(ok.length, 1, JSON.stringify(answers.map((a) => a.body)));
        const loser = answers.find((a) => a.status !== 200)!;
        await expectError(loser, 'failed-precondition', 'VERSION_CONFLICT');
        const so = await storeOrderRow(ctx, placed.storeOrderId);
        assert.equal(so.status, 'accepted');
        assert.equal(so.version, 1);
        assert.equal(await offerCount(ctx, placed.deliveryId!), 1);
      },
    });
  });

  test('hand-over against release: either the hand-over wins or the release does, never a mix', async () => {
    let handOvers = 0;
    let releases = 0;
    await race({
      times: 25,
      setup: async () => {
        const placed = await boltbin();
        await expectOk(accept(owner, placed.storeOrderId, 0));
        await expectOk(markReady(owner, placed.storeOrderId, 1));
        const pin = await claimFor(ctx, placed, driver);
        return { placed, pin };
      },
      run: ({ placed, pin }) => [
        async (): Promise<Answer<unknown>> => pickupWith(owner, placed.storeOrderId, 2, pin),
        async (): Promise<Answer<unknown>> => ({
          status: 0,
          body: await releaseFor(ctx, placed),
          headers: {},
        }),
      ],
      check: async (answers, { placed }) => {
        const pickup = answers[0]!;
        const so = await storeOrderRow(ctx, placed.storeOrderId);
        const delivery = await deliveryRow(ctx, placed.deliveryId!);
        if (pickup.status === 200) {
          handOvers += 1;
          assert.equal(answers[1]!.body, 'too_late');
          assert.equal(so.status, 'out_for_delivery');
          assert.equal(delivery.status, 'picked_up');
          assert.equal(delivery.driverId, driver.uid);
        } else {
          releases += 1;
          await expectError(pickup, 'failed-precondition', 'DRIVER_NOT_ASSIGNED');
          assert.equal(answers[1]!.body, 'released');
          assert.equal(so.status, 'ready');
          assert.equal(so.version, 2);
          assert.equal(delivery.status, 'unassigned');
          assert.equal(delivery.driverId, null);
          assert.deepEqual(await stock(ctx, placed.hangers), { onHand: 30, reserved: 24 });
        }
      },
    });
    assert.equal(handOvers + releases, 25);
  });

  test('hand-over against release, both orders forced with the completePickup:locked hold point', async () => {
    // Release first: the hand-over waits at its lock... then sees no driver.
    const a = await boltbin();
    await expectOk(accept(owner, a.storeOrderId, 0));
    await expectOk(markReady(owner, a.storeOrderId, 1));
    const pinA = await claimFor(ctx, a, driver);
    assert.equal(await releaseFor(ctx, a), 'released');
    await expectError(
      pickupWith(owner, a.storeOrderId, 2, pinA),
      'failed-precondition',
      'DRIVER_NOT_ASSIGNED',
    );

    // Hand-over holds the locks; the release queues behind them and finds the load gone.
    const b = await boltbin();
    await expectOk(accept(owner, b.storeOrderId, 0));
    await expectOk(markReady(owner, b.storeOrderId, 1));
    const pinB = await claimFor(ctx, b, driver);
    const held = ctx.hooks.hold('completePickup:locked');
    const pickup = pickupWith(owner, b.storeOrderId, 2, pinB);
    await held.reached();
    const release = releaseFor(ctx, b);
    held.release();
    const [answer, released] = await Promise.all([pickup, release]);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(released, 'too_late');
    assert.equal((await deliveryRow(ctx, b.deliveryId!)).status, 'picked_up');
  });
});
