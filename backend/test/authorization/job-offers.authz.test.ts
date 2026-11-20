/**
 * Authorization of the job board (docs/PLATFORM.md §7.3, §7.4, §12.4; MARKETPLACE §13.2), owner `deliveries`.
 * An offer is visible only to an active driver whose `{cityId}:{capacityClass}` is in its audience (city,
 * class, the site maximum) while it is open; a car driver never sees a pickup-truck job; another city is
 * denied; a pending driver sees nothing; scheduled offers are hidden from drivers; staff see every offer.
 * The fixture proves an offer contains no customer name, phone, exact address or site contact.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  Amounts,
  CityId,
  JobOffer,
  JobsiteSnapshot,
  LoadSummary,
  Order,
  Page,
  StoreOrder,
  StoreOrderLine,
  StoreOrderPrivateMeta,
  VehicleClass,
  WithId,
} from '@instasupply/shared';
import { stageMarketplaceDelivery } from '../../src/modules/deliveries';
import { withTransaction } from '../../src/platform/db/tx';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { HOUR, MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { createProduct } from '../support/fixtures';
import { expectError, expectOk, request } from '../support/http';

// ---------- fixture: an order with one delivery store order, as placeOrder leaves it ----------

const LOAD = (vehicleClass: VehicleClass): LoadSummary => ({
  pieces: 26,
  weightG: 182_000,
  weightKg: 182,
  longestCm: 244,
  volumeL: 400,
  hasSheets: false,
  handlingPieces: 2,
  heaviestUnitKg: 12,
  heavy: false,
  vehicleClass,
  summary: '20 × 2x4x8 SPF stud, 6 × Deck screws 5 lb',
  lines: [
    { name: '2x4x8 SPF stud', quantity: 20, unit: 'each', size: null, weightKg: 7, longestCm: 244 },
    { name: 'Deck screws 5 lb', quantity: 6, unit: 'box', size: null, weightKg: 2.3, longestCm: 20 },
  ],
});

const amounts = (itemsCents: number): Amounts => {
  const tax = Math.round((itemsCents * 1300) / 10_000);
  return {
    itemsCents,
    discountCents: 0,
    deliveryFeeCents: 2999,
    unloadFeeCents: 0,
    taxCents: tax + 390,
    totalCents: itemsCents + 2999 + tax + 390,
  };
};

let serial = 20000;

interface JobSpec {
  customer: ActorClient;
  storeId: string;
  storeName: string;
  productId: string;
  vehicleClass?: VehicleClass;
  jobsiteCityId?: CityId;
  maxVehicleClass?: VehicleClass | null;
  /** Minutes from now until the target pickup (default 40: due soon). */
  pickupInMin?: number;
  receiving?: 'attended' | 'unattended';
}

interface PlacedJob {
  orderId: string;
  storeOrderId: string;
  deliveryId: string;
  number: string;
}

/** One order with one delivery store order, as placeOrder leaves it: `new`, delivery `held`. */
async function placeJob(ctx: TestContext, spec: JobSpec): Promise<PlacedJob> {
  const now = ctx.clock.now();
  serial += 1;
  const orderId = randomUUID();
  const number = `IS-${serial}`;
  const storeOrderId = `${orderId}-A`;
  const deliveryId = randomUUID();
  const vehicleClass = spec.vehicleClass ?? 'pickup';
  const readyBy = now + (spec.pickupInMin ?? 40) * MINUTE;
  const deliverBy = readyBy + 60 * MINUTE;
  const placed = amounts(20 * 649);
  const receiving = spec.receiving ?? 'attended';
  const jobsite: JobsiteSnapshot = {
    jobsiteId: null,
    addressLine: '12 Pape Ave, Toronto',
    label: 'Leslieville semi reno',
    line1: '12 Pape Ave',
    line2: null,
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M4M 2E3',
    location: { lat: 43.66481, lng: -79.34053 },
    cityId: spec.jobsiteCityId ?? 'toronto',
    areaLabel: 'Leslieville · M4M',
    contactName: 'Pat Site',
    contactPhone: '+14165550110',
    instructions: 'Gate code 4411',
    receiving,
    maxVehicleClass: spec.maxVehicleClass ?? null,
  };
  const lines: StoreOrderLine[] = [
    {
      lineId: 'L1',
      kind: 'catalog',
      productId: spec.productId,
      sku: 'SPF-248',
      name: '2x4x8 SPF stud',
      brand: null,
      unit: 'each',
      size: null,
      categoryId: 'wood',
      imageKey: null,
      imageUrl: null,
      unitPriceCents: 649,
      quantity: 20,
      fulfilledQty: 20,
      shortReason: null,
      lineCents: 20 * 649,
      discountCents: 0,
      weightKg: 7,
      dimsCm: { l: 244, w: 9, h: 4 },
      note: null,
    },
  ];
  const window = {
    id: 'asap',
    kind: 'asap' as const,
    date: '2026-11-19',
    startAt: null,
    endAt: deliverBy,
    label: 'Today',
  };
  const so: StoreOrder = {
    id: storeOrderId,
    number: `${number}-A`,
    letter: 'A',
    orderId,
    orderNumber: number,
    source: 'cart',
    storeId: spec.storeId,
    storeName: spec.storeName,
    storeAddressLine: 'Dixon Rd & Martin Grove Rd, Toronto',
    storeLocation: { lat: 43.6966, lng: -79.5752 },
    storePhone: '+14165550120',
    customerId: spec.customer.uid,
    customerName: 'Dana Whitfield',
    companyName: null,
    customerPhone: '+14165550199',
    fulfilment: 'delivery',
    jobsite,
    receiving,
    siteContact: { name: 'Pat Site', phone: '+14165550110' },
    instructions: 'Stack by the garage',
    window,
    timing: {
      respondBy: now + 10 * MINUTE,
      readyBy,
      readyByDate: '2026-11-19',
      targetPickupAt: readyBy,
      deliverBy,
    },
    lines,
    lineCount: 1,
    itemCount: 20,
    itemsSummary: '20 × 2x4x8 SPF stud',
    load: LOAD(vehicleClass),
    vehicleClass,
    roadKm: 18.4,
    unload: { offered: true, required: false, selected: false, feeCents: 0 },
    deliveryFeeListCents: 2999,
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
        actorId: spec.customer.uid,
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
  const order: Order = {
    id: orderId,
    number,
    source: 'cart',
    quoteId: null,
    issueId: null,
    customerId: spec.customer.uid,
    customerName: so.customerName,
    companyName: null,
    customerPhone: so.customerPhone,
    fulfilment: 'delivery',
    jobsite,
    receiving,
    siteContact: so.siteContact,
    window,
    instructions: so.instructions,
    storeOrderIds: [storeOrderId],
    storeCount: 1,
    lineCount: 1,
    itemCount: 20,
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
      captureDeadlineAt: now + 6 * 24 * HOUR,
      capturedAt: null,
      events: [],
    },
    storeOrders: [
      {
        storeOrderId,
        number: so.number,
        letter: 'A',
        storeId: spec.storeId,
        storeName: spec.storeName,
        fulfilment: 'delivery',
        status: 'new',
        itemCount: 20,
        itemsSummary: so.itemsSummary,
        currentTotalCents: placed.totalCents,
        deliverBy,
        readyAt: null,
        holdUntil: null,
        trackingToken: null,
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
    await tx.query('UPDATE products SET reserved = reserved + 20 WHERE id = $1', [spec.productId]);
    const staged = await stageMarketplaceDelivery(tx, {
      deliveryId,
      storeOrder: so,
      actor: { id: spec.customer.uid, name: 'Dana Whitfield', role: 'customer' },
    });
    await tx.query(
      `UPDATE orders SET doc = jsonb_set(doc, '{storeOrders,0,trackingToken}', to_jsonb($2::text)) WHERE id = $1`,
      [orderId, staged.trackingToken],
    );
  });
  return { orderId, storeOrderId, deliveryId, number: so.number };
}

const versionOf = async (actor: ActorClient, storeOrderId: string): Promise<number> =>
  (await expectOk(actor.get<StoreOrder>(`/store-orders/${storeOrderId}`))).version;

async function accept(actor: ActorClient, storeOrderId: string): Promise<void> {
  await expectOk(
    actor.call('acceptStoreOrder', { storeOrderId, expectedVersion: await versionOf(actor, storeOrderId) }),
  );
}

describe('job offers authorization (MARKETPLACE §13.2: job offers)', () => {
  let ctx: TestContext;
  let admin: ActorClient;
  let dispatcher: ActorClient;
  let customer: ActorClient;
  let owner: ActorClient & { storeId: string };
  let supplierY: ActorClient;
  let pickupDriver: ActorClient;
  let carDriver: ActorClient;
  let otherCity: ActorClient;
  let boxTruck: ActorClient;
  let pendingDriver: ActorClient;
  let open: PlacedJob;
  let lane: PlacedJob;
  let later: PlacedJob;

  const ids = (page: Page<WithId<JobOffer>>) => page.items.map((item) => item.id);

  before(async () => {
    ctx = await createTestContext();
    admin = await newAdmin(ctx);
    dispatcher = await newDispatcher(ctx);
    customer = await newCustomer(ctx);
    owner = await newSupplier(ctx, { store: { name: 'Kestrel Lumber Yard', cityId: 'toronto' } });
    supplierY = await newSupplier(ctx);
    pickupDriver = await newDriver(ctx, { capacityClass: 'pickup' });
    carDriver = await newDriver(ctx, { capacityClass: 'car' });
    otherCity = await newDriver(ctx, { capacityClass: 'pickup', cityId: 'oakville' });
    boxTruck = await newDriver(ctx, { capacityClass: 'box_truck' });
    pendingDriver = await newDriver(ctx, { capacityClass: 'pickup', status: 'pending' });
    const product = await createProduct(ctx, owner.storeId, { sku: 'SPF-248', stockOnHand: 1000 });
    const base = {
      customer,
      storeId: owner.storeId,
      storeName: 'Kestrel Lumber Yard',
      productId: product.id,
    };
    open = await placeJob(ctx, { ...base, vehicleClass: 'pickup' });
    lane = await placeJob(ctx, { ...base, vehicleClass: 'pickup', maxVehicleClass: 'cargo_van' });
    later = await placeJob(ctx, { ...base, vehicleClass: 'pickup', pickupInMin: 20 * 60 });
    for (const job of [open, lane, later]) await accept(owner, job.storeOrderId);
  });
  after(() => ctx.close());

  test('the fixture: an offer contains no customer name, phone, exact address or site contact', async () => {
    const offer = await expectOk(dispatcher.get<WithId<JobOffer>>(`/job-offers/${open.deliveryId}`));
    const json = JSON.stringify(offer);
    for (const secret of [
      'Pat Site',
      '+14165550110',
      '+14165550199',
      '12 Pape Ave',
      'Dana',
      'Gate code',
      'garage',
    ]) {
      assert.ok(!json.includes(secret), `the offer contains ${secret}`);
    }
    assert.equal(offer.id, open.deliveryId);
    assert.equal(offer.dropoff.areaLabel, 'Leslieville · M4M');
  });

  test('a driver in the city and class sees the open offer, in the list and by id', async () => {
    const board = await expectOk(pickupDriver.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(ids(board).includes(open.deliveryId));
    assert.ok(ids(board).includes(lane.deliveryId));
    await expectOk(pickupDriver.get(`/job-offers/${open.deliveryId}`));
  });

  test('a car driver never sees a pickup-truck job', async () => {
    const board = await expectOk(carDriver.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(!ids(board).includes(open.deliveryId));
    await expectError(carDriver.get(`/job-offers/${open.deliveryId}`), 'permission-denied');
  });

  test('a driver of another city is denied', async () => {
    const board = await expectOk(otherCity.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.equal(board.items.length, 0);
    await expectError(otherCity.get(`/job-offers/${open.deliveryId}`), 'permission-denied');
    await expectError(otherCity.call('claimJob', { deliveryId: open.deliveryId }), 'permission-denied');
  });

  test('the site maximum: a box truck does not see a "cargo van max" job, but sees the open one', async () => {
    const board = await expectOk(boxTruck.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(ids(board).includes(open.deliveryId));
    assert.ok(!ids(board).includes(lane.deliveryId));
    await expectError(boxTruck.get(`/job-offers/${lane.deliveryId}`), 'permission-denied');
  });

  test('scheduled offers are hidden from drivers (even when asked for); staff see them', async () => {
    const board = await expectOk(
      pickupDriver.get<Page<WithId<JobOffer>>>('/job-offers?status=scheduled,open'),
    );
    assert.ok(!ids(board).includes(later.deliveryId));
    await expectError(pickupDriver.get(`/job-offers/${later.deliveryId}`), 'not-found');
    for (const staff of [dispatcher, admin]) {
      const all = await expectOk(
        staff.get<Page<WithId<JobOffer>>>('/job-offers?status=scheduled,open&sort=opensAt:asc'),
      );
      assert.ok(ids(all).includes(later.deliveryId));
      assert.ok(ids(all).includes(open.deliveryId));
      await expectOk(staff.get(`/job-offers/${later.deliveryId}`));
    }
  });

  test('a pending driver, customers, suppliers and anonymous callers see no offer and cannot claim', async () => {
    for (const actor of [pendingDriver, customer, owner, supplierY]) {
      await expectError(actor.get('/job-offers'), 'permission-denied');
      await expectError(actor.get(`/job-offers/${open.deliveryId}`), 'permission-denied');
      await expectError(actor.call('claimJob', { deliveryId: open.deliveryId }), 'permission-denied');
    }
    await expectError(request(ctx, 'GET', '/job-offers'), 'unauthenticated');
    await expectError(
      request(ctx, 'POST', '/call/claimJob', { deliveryId: open.deliveryId }),
      'unauthenticated',
    );
  });

  test('boostJobPayout is staff-only; a claimed offer is gone for everyone', async () => {
    for (const actor of [pickupDriver, customer, owner]) {
      await expectError(
        actor.call('boostJobPayout', { deliveryId: open.deliveryId, addCents: 500 }),
        'permission-denied',
      );
    }
    await expectOk(pickupDriver.call('claimJob', { deliveryId: open.deliveryId }));
    await expectError(boxTruck.get(`/job-offers/${open.deliveryId}`), 'not-found');
    await expectError(dispatcher.get(`/job-offers/${open.deliveryId}`), 'not-found');
    const board = await expectOk(boxTruck.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(!ids(board).includes(open.deliveryId));
  });
});
