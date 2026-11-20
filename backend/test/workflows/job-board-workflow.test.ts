/**
 * Job board workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3, owner `deliveries`): offers scheduled → open
 * through runJob; two concurrent claims; class, city and 4-job limits (and claim against the limit at once);
 * a pending vehicle downgrade; release reopens the offer, clears the PIN (the old PIN fails at the counter)
 * and RELEASED_RECENTLY; suspension releases uncollected jobs; a driver cannot mark picked_up; the hand-over
 * moves both rows; photo required; tracking phases; failure → reattempt and return; route stops with the
 * pickup before the drop-off; ledger entries created once; boost.
 *
 * Orders are written straight into the tables, shaped as the order writer of §9.2.1 leaves them, and the
 * delivery is staged by `stageMarketplaceDelivery`: this file tests the deliveries module, not checkout.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  Amounts,
  CityId,
  Delivery,
  DeliveryEvent,
  JobOffer,
  JobsiteSnapshot,
  LoadSummary,
  Order,
  Page,
  PublicTracking,
  StoreOrder,
  StoreOrderLine,
  StoreOrderPrivateMeta,
  VehicleClass,
  WithId,
} from '@instasupply/shared';
import { withTransaction } from '../../src/platform/db/tx';
import { stageMarketplaceDelivery } from '../../src/modules/deliveries';
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
import { expectError, expectOk } from '../support/http';
import { outboxEvents } from '../support/outbox';
import { race } from '../support/race';

// ---------- fixtures ----------

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

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

// ---------- helpers ----------

interface World {
  customer: ActorClient;
  owner: ActorClient & { storeId: string };
  dispatcher: ActorClient;
  admin: ActorClient;
  storeName: string;
  productId: string;
}

const versionOf = async (actor: ActorClient, storeOrderId: string): Promise<number> =>
  (await expectOk(actor.get<StoreOrder>(`/store-orders/${storeOrderId}`))).version;

async function accept(actor: ActorClient, storeOrderId: string): Promise<void> {
  await expectOk(
    actor.call('acceptStoreOrder', { storeOrderId, expectedVersion: await versionOf(actor, storeOrderId) }),
  );
}

async function markReady(actor: ActorClient, storeOrderId: string): Promise<void> {
  await expectOk(
    actor.call('updateStoreOrderStatus', {
      storeOrderId,
      expectedVersion: await versionOf(actor, storeOrderId),
      status: 'ready',
    }),
  );
}

const pinOf = async (staff: ActorClient, storeOrderId: string): Promise<string | null> =>
  (await expectOk(staff.get<StoreOrderPrivateMeta>(`/store-orders/${storeOrderId}/private`))).pickupCode;

const handOver = async (store: ActorClient, storeOrderId: string, pin: string | null) =>
  store.call('completePickup', {
    storeOrderId,
    expectedVersion: await versionOf(store, storeOrderId),
    pickupCode: pin,
  });

async function deliveryRow(ctx: TestContext, id: string): Promise<Delivery> {
  const { rows } = await ctx.pool.query<{ doc: Omit<Delivery, 'id'> }>(
    'SELECT doc FROM deliveries WHERE id = $1',
    [id],
  );
  return { ...rows[0]!.doc, id } as Delivery;
}

async function offerRow(ctx: TestContext, id: string): Promise<JobOffer | null> {
  const { rows } = await ctx.pool.query<{ doc: JobOffer }>(
    'SELECT doc FROM job_offers WHERE delivery_id = $1',
    [id],
  );
  return rows[0]?.doc ?? null;
}

async function storeOrderRow(
  ctx: TestContext,
  id: string,
): Promise<StoreOrder & { meta: StoreOrderPrivateMeta }> {
  const { rows } = await ctx.pool.query<{ doc: StoreOrder; meta: StoreOrderPrivateMeta }>(
    'SELECT doc, meta FROM store_orders WHERE id = $1',
    [id],
  );
  return { ...rows[0]!.doc, id, meta: rows[0]!.meta };
}

/** Puts every driver online at the fake clock (claims due within 2 h need a fresh fix). */
async function freshLocations(ctx: TestContext): Promise<void> {
  await ctx.pool.query('UPDATE driver_locations SET online = true, updated_at = $1', [
    new Date(ctx.clock.now()),
  ]);
}

async function uploadProof(ctx: TestContext, driver: ActorClient, deliveryId: string): Promise<string> {
  const ticket = await expectOk(
    driver.post<{ uploadId: string; path: string }>('/files/presign', {
      purpose: 'proof',
      ownerId: deliveryId,
      fileName: 'drop-off.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    }),
  );
  await ctx.deps.storage.put(`uploads/${ticket.uploadId}`, PNG, 'image/png');
  await expectOk(driver.post('/files/confirm', { uploadId: ticket.uploadId }));
  return ticket.path;
}

const trackingOf = async (ctx: TestContext, deliveryId: string): Promise<PublicTracking> => {
  const { rows } = await ctx.pool.query<{ token: string }>(
    `SELECT meta->>'trackingToken' AS token FROM deliveries WHERE id = $1`,
    [deliveryId],
  );
  const answer = await ctx.app.inject({ method: 'GET', url: `/api/v1/tracking/${rows[0]!.token}` });
  assert.equal(answer.statusCode, 200, answer.body);
  return JSON.parse(answer.body) as PublicTracking;
};

// ---------- the tests ----------

describe('job board workflow (MARKETPLACE §13.3, PLATFORM §9.2.5 to §9.2.9)', () => {
  let ctx: TestContext;
  let world: World;

  const job = (spec: Partial<JobSpec> = {}) =>
    placeJob(ctx, {
      customer: world.customer,
      storeId: world.owner.storeId,
      storeName: world.storeName,
      productId: world.productId,
      ...spec,
    });

  /** A placed and accepted job whose offer is open. */
  const openJob = async (spec: Partial<JobSpec> = {}) => {
    const placed = await job(spec);
    await accept(world.owner, placed.storeOrderId);
    return placed;
  };

  before(async () => {
    ctx = await createTestContext();
    const owner = await newSupplier(ctx, {
      store: { name: 'Kestrel Lumber Yard', cityId: 'toronto', areaLabel: 'Etobicoke' },
    });
    const product = await createProduct(ctx, owner.storeId, {
      sku: 'SPF-248',
      name: '2x4x8 SPF stud',
      stockOnHand: 10_000,
    });
    world = {
      customer: await newCustomer(ctx, { displayName: 'Dana Whitfield' }),
      owner,
      dispatcher: await newDispatcher(ctx),
      admin: await newAdmin(ctx),
      storeName: 'Kestrel Lumber Yard',
      productId: product.id,
    };
  });
  after(() => ctx.close());

  test('the store accepts: the held delivery gets an open offer, without customer data, visible to fitting drivers', async () => {
    const placed = await job();
    const held = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(held.offerStatus, 'held');
    assert.equal(await offerRow(ctx, placed.deliveryId), null);
    const marco = await newDriver(ctx, { capacityClass: 'pickup', displayName: 'Marco Rossi' });

    await accept(world.owner, placed.storeOrderId);
    const offer = await offerRow(ctx, placed.deliveryId);
    assert.ok(offer);
    assert.equal(offer.status, 'open');
    assert.equal((await deliveryRow(ctx, placed.deliveryId)).offerStatus, 'open');
    const json = JSON.stringify(offer);
    for (const secret of ['Pat Site', '+14165550110', '12 Pape Ave', 'Dana', 'Gate code']) {
      assert.ok(!json.includes(secret), `the offer leaks ${secret}`);
    }
    assert.deepEqual(offer.dropoff.approxLocation, { lat: 43.66, lng: -79.34 });

    const board = await expectOk(marco.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(board.items.some((item) => item.id === placed.deliveryId));
    const notified = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'job_offer'`,
      [marco.uid],
    );
    assert.equal(notified.rowCount, 1);
  });

  test('an offer for a later pickup is scheduled, then opened by publishDueJobOffers', async () => {
    const placed = await job({ pickupInMin: 20 * 60 });
    await accept(world.owner, placed.storeOrderId);
    const scheduled = await offerRow(ctx, placed.deliveryId);
    assert.equal(scheduled?.status, 'scheduled');
    assert.equal((await deliveryRow(ctx, placed.deliveryId)).offerStatus, 'scheduled');
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    const board = await expectOk(driver.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(!board.items.some((item) => item.id === placed.deliveryId), 'scheduled offers are hidden');

    const early = await ctx.runJob('publishDueJobOffers', scheduled!.opensAt - MINUTE);
    assert.equal(early.opened, 0);
    const result = await ctx.runJob('publishDueJobOffers', scheduled!.opensAt + MINUTE);
    assert.equal(result.opened, 1);
    const opened = await offerRow(ctx, placed.deliveryId);
    assert.equal(opened?.status, 'open');
    assert.equal(opened?.openedAt, scheduled!.opensAt + MINUTE);
    assert.equal((await deliveryRow(ctx, placed.deliveryId)).offerStatus, 'open');

    // 15 minutes later nobody has claimed it: staff are nudged once.
    const nudge = await ctx.runJob('publishDueJobOffers', scheduled!.opensAt + 17 * MINUTE);
    assert.equal(nudge.nudged, 1);
    const again = await ctx.runJob('publishDueJobOffers', scheduled!.opensAt + 30 * MINUTE);
    assert.equal(again.nudged, 0);
    await expectOk(
      world.dispatcher.call('assignDelivery', { deliveryId: placed.deliveryId, driverId: null }),
    );
  });

  test('two drivers claim the same offer at once: exactly one wins and holds the only PIN', async () => {
    await race({
      times: 10,
      setup: async () => {
        const placed = await openJob();
        const a = await newDriver(ctx, { capacityClass: 'pickup' });
        const b = await newDriver(ctx, { capacityClass: 'box_truck' });
        return { placed, a, b };
      },
      run: ({ placed, a, b }) => [
        () => a.call<{ status: string }>('claimJob', { deliveryId: placed.deliveryId }),
        () => b.call<{ status: string }>('claimJob', { deliveryId: placed.deliveryId }),
      ],
      check: async (answers, { placed, a, b }) => {
        const won = answers.filter((answer) => answer.status === 200);
        const lost = answers.filter((answer) => answer.status !== 200);
        assert.equal(won.length, 1, JSON.stringify(answers.map((x) => x.body)));
        assert.deepEqual(won[0]!.body, { deliveryId: placed.deliveryId, status: 'accepted' });
        await expectError(lost[0]!, 'failed-precondition', 'OFFER_TAKEN');
        const delivery = await deliveryRow(ctx, placed.deliveryId);
        const winner = answers[0]!.status === 200 ? a : b;
        assert.equal(delivery.driverId, winner.uid);
        assert.equal(delivery.status, 'accepted');
        assert.equal(await offerRow(ctx, placed.deliveryId), null);
        const so = await storeOrderRow(ctx, placed.storeOrderId);
        assert.equal(so.meta.pickupCodeIssuedTo, winner.uid);
        assert.equal(delivery.pickup?.pickupCode, so.meta.pickupCode);
      },
    });
  });

  test('a claim by the driver who already holds the job answers the same', async () => {
    const placed = await openJob();
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    const first = await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    const second = await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    assert.deepEqual(first, second);
  });

  test('class, city, site maximum and the 4-job limit', async () => {
    const placed = await openJob({ vehicleClass: 'pickup' });
    const car = await newDriver(ctx, { capacityClass: 'car' });
    await expectError(
      car.call('claimJob', { deliveryId: placed.deliveryId }),
      'failed-precondition',
      'VEHICLE_TOO_SMALL',
    );
    const elsewhere = await newDriver(ctx, { capacityClass: 'pickup', cityId: 'oakville' });
    await expectError(elsewhere.call('claimJob', { deliveryId: placed.deliveryId }), 'permission-denied');

    const lane = await openJob({ vehicleClass: 'pickup', maxVehicleClass: 'cargo_van' });
    const truck = await newDriver(ctx, { capacityClass: 'box_truck' });
    const board = await expectOk(truck.get<Page<WithId<JobOffer>>>('/job-offers'));
    assert.ok(
      !board.items.some((item) => item.id === lane.deliveryId),
      'the site maximum hides it from a box truck',
    );
    await expectError(
      truck.call('claimJob', { deliveryId: lane.deliveryId }),
      'failed-precondition',
      'VEHICLE_TOO_SMALL',
    );

    const busy = await newDriver(ctx, { capacityClass: 'flatbed' });
    for (let i = 0; i < 4; i += 1) {
      const next = await openJob();
      await expectOk(busy.call('claimJob', { deliveryId: next.deliveryId }));
    }
    const fifth = await openJob();
    await expectError(
      busy.call('claimJob', { deliveryId: fifth.deliveryId }),
      'resource-exhausted',
      'TOO_MANY_JOBS',
    );
  });

  test('claim against the limit: with 3 active jobs, two claims at once give exactly one more', async () => {
    await race({
      times: 5,
      setup: async () => {
        const driver = await newDriver(ctx, { capacityClass: 'flatbed' });
        for (let i = 0; i < 3; i += 1) {
          const next = await openJob();
          await expectOk(driver.call('claimJob', { deliveryId: next.deliveryId }));
        }
        return { driver, x: await openJob(), y: await openJob() };
      },
      run: ({ driver, x, y }) => [
        () => driver.call('claimJob', { deliveryId: x.deliveryId }),
        () => driver.call('claimJob', { deliveryId: y.deliveryId }),
      ],
      check: async (answers, { driver }) => {
        assert.equal(answers.filter((answer) => answer.status === 200).length, 1);
        await expectError(
          answers.find((answer) => answer.status !== 200)!,
          'resource-exhausted',
          'TOO_MANY_JOBS',
        );
        const { rows } = await ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM deliveries WHERE driver_id = $1 AND status = 'accepted'`,
          [driver.uid],
        );
        assert.equal(rows[0]!.n, 4);
      },
    });
  });

  test('a vehicle change waiting for review refuses jobs the new vehicle cannot carry', async () => {
    const driver = await newDriver(ctx, { capacityClass: 'cargo_van' });
    await expectOk(
      driver.call('updateDriverVehicle', {
        vehicle: {
          type: 'car',
          make: 'Honda',
          model: 'Civic',
          year: 2020,
          plate: 'CAR 123',
          colour: null,
          boxLengthFt: null,
          payloadKg: null,
          extras: [],
        },
      }),
    );
    const placed = await openJob({ vehicleClass: 'pickup' });
    await expectError(
      driver.call('claimJob', { deliveryId: placed.deliveryId }),
      'failed-precondition',
      'VEHICLE_TOO_SMALL',
    );
    const small = await openJob({ vehicleClass: 'car' });
    await expectOk(driver.call('claimJob', { deliveryId: small.deliveryId }));
  });

  test('release reopens the offer and clears the PIN; the old PIN fails at the counter; RELEASED_RECENTLY', async () => {
    const placed = await openJob();
    const marco = await newDriver(ctx, { capacityClass: 'pickup', displayName: 'Marco Rossi' });
    await expectOk(marco.call('claimJob', { deliveryId: placed.deliveryId }));
    const oldPin = await pinOf(world.dispatcher, placed.storeOrderId);
    assert.ok(oldPin);

    await expectError(
      marco.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'unassigned' }),
      'invalid-argument',
    );
    await expectOk(
      marco.call('updateDeliveryStatus', {
        deliveryId: placed.deliveryId,
        status: 'unassigned',
        declineReason: 'store_delay',
      }),
    );
    const released = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(released.status, 'unassigned');
    assert.equal(released.driverId, null);
    assert.equal(released.pickup?.pickupCode, null);
    assert.equal(released.offerStatus, 'open');
    assert.ok(released.declinedBy?.includes(marco.uid));
    assert.equal(typeof released.releasedBy[marco.uid], 'number');
    assert.equal((await offerRow(ctx, placed.deliveryId))?.status, 'open');
    await expectError(marco.get(`/deliveries/${placed.deliveryId}`), 'permission-denied');

    await markReady(world.owner, placed.storeOrderId);
    await expectError(
      handOver(world.owner, placed.storeOrderId, oldPin),
      'failed-precondition',
      'DRIVER_NOT_ASSIGNED',
    );
    await expectError(
      marco.call('claimJob', { deliveryId: placed.deliveryId }),
      'failed-precondition',
      'RELEASED_RECENTLY',
    );
    // An hour later the cooldown is over (moved in the data: advancing the clock would expire the tokens).
    await ctx.pool.query(
      `UPDATE deliveries SET doc = jsonb_set(doc, ARRAY['releasedBy', $2::text], to_jsonb($3::bigint)) WHERE id = $1`,
      [placed.deliveryId, marco.uid, ctx.clock.now() - 61 * MINUTE],
    );
    await freshLocations(ctx);
    await expectOk(marco.call('claimJob', { deliveryId: placed.deliveryId }));
  });

  test('suspending a driver releases the uncollected jobs, each with a system event, and re-creates the offers', async () => {
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    const a = await openJob();
    const b = await openJob();
    await expectOk(driver.call('claimJob', { deliveryId: a.deliveryId }));
    await expectOk(driver.call('claimJob', { deliveryId: b.deliveryId }));
    await expectOk(
      world.admin.call('setDriverStatus', { uid: driver.uid, status: 'suspended', reason: 'Test' }),
    );
    for (const id of [a.deliveryId, b.deliveryId]) {
      const delivery = await deliveryRow(ctx, id);
      assert.equal(delivery.status, 'unassigned');
      assert.equal(delivery.driverId, null);
      assert.equal((await offerRow(ctx, id))?.status, 'open');
      const events = await expectOk(world.dispatcher.get<Page<DeliveryEvent>>(`/deliveries/${id}/events`));
      assert.ok(
        events.items.some(
          (event) => event.message === 'Released: driver suspended' && event.actorRole === 'system',
        ),
      );
    }
    await expectError(driver.get('/me'), 'permission-denied');
  });

  test('the full trip: a driver cannot mark picked_up; check-in, hand-over, photo required, delivered; tracking phases', async () => {
    const placed = await openJob({ receiving: 'unattended' });
    const marco = await newDriver(ctx, { capacityClass: 'pickup', displayName: 'Marco Rossi' });
    await expectOk(marco.call('claimJob', { deliveryId: placed.deliveryId }));
    assert.equal((await trackingOf(ctx, placed.deliveryId)).phase, 'to_store');

    await expectError(
      marco.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'picked_up' }),
      'failed-precondition',
    );
    await expectError(
      world.dispatcher.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'picked_up' }),
      'failed-precondition',
    );
    // The projection onto the store order is monotonic on the delivery's updatedAt: time moves on.
    ctx.clock.advance(MINUTE);
    await expectOk(marco.call('checkInAtStore', { deliveryId: placed.deliveryId }));
    await expectOk(marco.call('checkInAtStore', { deliveryId: placed.deliveryId }));
    const checkedIn = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(checkedIn.pickup?.arrivedAt, ctx.clock.now());
    assert.equal((await trackingOf(ctx, placed.deliveryId)).phase, 'at_store');
    assert.equal((await storeOrderRow(ctx, placed.storeOrderId)).driver?.phase, 'at_store');

    await markReady(world.owner, placed.storeOrderId);
    const pin = checkedIn.pickup!.pickupCode;
    ctx.clock.advance(5 * MINUTE);
    await expectOk(handOver(world.owner, placed.storeOrderId, pin));
    const loaded = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(loaded.status, 'picked_up');
    assert.equal((await storeOrderRow(ctx, placed.storeOrderId)).status, 'out_for_delivery');
    assert.equal((await trackingOf(ctx, placed.deliveryId)).phase, 'loaded');

    await expectOk(
      marco.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'in_transit' }),
    );
    assert.equal((await trackingOf(ctx, placed.deliveryId)).phase, 'to_site');
    const sms = await outboxEvents(ctx, 'sms.send');
    assert.equal(sms.filter((row) => String(row.payload.body).includes(placed.number)).length, 1);
    await expectOk(marco.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'arrived' }));
    const heads = await ctx.pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND dedupe_key = $2`, [
      world.customer.uid,
      `dl-arrived-${placed.deliveryId}-0`,
    ]);
    assert.equal(heads.rowCount, 1);

    await expectError(
      marco.call('completeDelivery', { deliveryId: placed.deliveryId, recipientName: 'Pat' }),
      'invalid-argument',
      'PHOTO_REQUIRED',
    );
    const photoPath = await uploadProof(ctx, marco, placed.deliveryId);
    await expectOk(marco.call('completeDelivery', { deliveryId: placed.deliveryId, photoPath }));
    await expectOk(marco.call('completeDelivery', { deliveryId: placed.deliveryId, photoPath }));
    const done = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(done.status, 'delivered');
    assert.equal(done.proof?.photoPath, photoPath);
    assert.equal((await storeOrderRow(ctx, placed.storeOrderId)).status, 'delivered');
    const tracking = await trackingOf(ctx, placed.deliveryId);
    assert.equal(tracking.phase, 'delivered');
    assert.equal(tracking.driver?.location ?? null, null);

    // The ledger entry of the delivery is written once, whatever is retried.
    const ledger = await ctx.pool.query(
      `SELECT id FROM ledger_entries WHERE payee_type = 'driver' AND payee_id = $1 AND delivery_id = $2`,
      [marco.uid, placed.deliveryId],
    );
    assert.equal(ledger.rowCount, 1);
  });

  test('an attended drop-off needs the hand-off code: wrong ×5 → CODE_LOCKED; staff can still complete', async () => {
    const placed = await openJob({ receiving: 'attended' });
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    await markReady(world.owner, placed.storeOrderId);
    await expectOk(
      handOver(world.owner, placed.storeOrderId, await pinOf(world.dispatcher, placed.storeOrderId)),
    );
    await expectOk(
      driver.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'in_transit' }),
    );
    const photoPath = await uploadProof(ctx, driver, placed.deliveryId);
    const { handoffCode } = await expectOk(
      world.dispatcher.get<{ handoffCode: string }>(`/deliveries/${placed.deliveryId}/private`),
    );
    const wrong = handoffCode === '0000' ? '1111' : '0000';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const error = await expectError(
        driver.call('completeDelivery', { deliveryId: placed.deliveryId, photoPath, handoffCode: wrong }),
        'invalid-argument',
        'CODE_INCORRECT',
      );
      assert.equal(error.details.remaining, 5 - attempt);
    }
    await expectError(
      driver.call('completeDelivery', { deliveryId: placed.deliveryId, photoPath, handoffCode }),
      'resource-exhausted',
      'CODE_LOCKED',
    );
    await expectOk(
      world.dispatcher.call('completeDelivery', { deliveryId: placed.deliveryId, note: 'Called the site' }),
    );
    assert.equal((await deliveryRow(ctx, placed.deliveryId)).status, 'delivered');
  });

  test('failure → reattempt, failure again → return to store', async () => {
    const placed = await openJob();
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    await markReady(world.owner, placed.storeOrderId);
    await expectOk(
      handOver(world.owner, placed.storeOrderId, await pinOf(world.dispatcher, placed.storeOrderId)),
    );
    const before = (
      await ctx.pool.query<{ stock: number }>('SELECT stock_on_hand AS stock FROM products WHERE id = $1', [
        world.productId,
      ])
    ).rows[0]!.stock;

    await expectOk(
      driver.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'in_transit' }),
    );
    await expectError(
      driver.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'failed' }),
      'invalid-argument',
    );
    await expectOk(
      driver.call('updateDeliveryStatus', {
        deliveryId: placed.deliveryId,
        status: 'failed',
        failureReason: 'no_one_on_site',
      }),
    );
    assert.equal((await storeOrderRow(ctx, placed.storeOrderId)).status, 'failed');
    await expectError(
      world.dispatcher.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'cancelled' }),
      'failed-precondition',
    );

    await expectOk(
      world.dispatcher.call('resolveFailedDelivery', {
        storeOrderId: placed.storeOrderId,
        action: 'reattempt',
      }),
    );
    const again = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(again.status, 'picked_up');
    assert.equal(again.attempts, 1);
    assert.equal((await storeOrderRow(ctx, placed.storeOrderId)).status, 'out_for_delivery');

    await expectOk(
      driver.call('updateDeliveryStatus', {
        deliveryId: placed.deliveryId,
        status: 'failed',
        failureReason: 'site_closed',
      }),
    );
    await expectOk(
      world.dispatcher.call('resolveFailedDelivery', {
        storeOrderId: placed.storeOrderId,
        action: 'return_to_store',
      }),
    );
    assert.equal((await deliveryRow(ctx, placed.deliveryId)).status, 'cancelled');
    const so = await storeOrderRow(ctx, placed.storeOrderId);
    assert.equal(so.status, 'cancelled');
    // Site-caused and not waived: the fees stay, the items are void.
    assert.equal(so.current.itemsCents, 0);
    assert.equal(so.current.deliveryFeeCents, 2999);
    const afterStock = (
      await ctx.pool.query<{ stock: number }>('SELECT stock_on_hand AS stock FROM products WHERE id = $1', [
        world.productId,
      ])
    ).rows[0]!.stock;
    assert.equal(afterStock, before + 20);
    await expectError(
      world.dispatcher.call('resolveFailedDelivery', {
        storeOrderId: placed.storeOrderId,
        action: 'reattempt',
      }),
      'failed-precondition',
    );
  });

  test('a checked-in job returned to the store pays the failure pay only, never cancellation pay (§3.9, §3.10)', async () => {
    const cases = [
      { reason: 'site_closed', failurePaid: true },
      { reason: 'damaged', failurePaid: false },
    ] as const;
    for (const { reason, failurePaid } of cases) {
      const placed = await openJob();
      const driver = await newDriver(ctx, { capacityClass: 'pickup' });
      await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
      ctx.clock.advance(MINUTE);
      await expectOk(driver.call('checkInAtStore', { deliveryId: placed.deliveryId }));
      await markReady(world.owner, placed.storeOrderId);
      await expectOk(
        handOver(world.owner, placed.storeOrderId, await pinOf(world.dispatcher, placed.storeOrderId)),
      );
      await expectOk(
        driver.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'in_transit' }),
      );
      await expectOk(
        driver.call('updateDeliveryStatus', {
          deliveryId: placed.deliveryId,
          status: 'failed',
          failureReason: reason,
        }),
      );
      await expectOk(
        world.dispatcher.call('resolveFailedDelivery', {
          storeOrderId: placed.storeOrderId,
          action: 'return_to_store',
        }),
      );
      assert.equal((await deliveryRow(ctx, placed.deliveryId)).status, 'cancelled');
      const { rows } = await ctx.pool.query<{ id: string }>(
        'SELECT id FROM ledger_entries WHERE delivery_id = $1 ORDER BY id',
        [placed.deliveryId],
      );
      const ids = rows.map((row) => row.id);
      assert.deepEqual(
        ids,
        failurePaid ? [`failed_${placed.deliveryId}_1`] : [],
        `${reason}: ${ids.join(', ')}`,
      );
    }
  });

  test('dispatch assigns a job (offer deleted, new PIN), refuses a too-small vehicle unless forced, and unassigns', async () => {
    const placed = await openJob({ vehicleClass: 'pickup' });
    const car = await newDriver(ctx, { capacityClass: 'car' });
    await expectError(
      world.dispatcher.call('assignDelivery', { deliveryId: placed.deliveryId, driverId: car.uid }),
      'failed-precondition',
      'VEHICLE_TOO_SMALL',
    );
    await expectOk(
      world.dispatcher.call('assignDelivery', {
        deliveryId: placed.deliveryId,
        driverId: car.uid,
        force: true,
      }),
    );
    let delivery = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(delivery.status, 'assigned');
    assert.equal(delivery.offerStatus, 'claimed');
    assert.equal(await offerRow(ctx, placed.deliveryId), null);
    assert.equal((await storeOrderRow(ctx, placed.storeOrderId)).meta.pickupCodeIssuedTo, car.uid);
    await expectOk(car.call('updateDeliveryStatus', { deliveryId: placed.deliveryId, status: 'accepted' }));

    await expectOk(
      world.dispatcher.call('assignDelivery', { deliveryId: placed.deliveryId, driverId: null }),
    );
    delivery = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(delivery.status, 'unassigned');
    assert.equal(delivery.pickup?.pickupCode, null);
    assert.equal((await offerRow(ctx, placed.deliveryId))?.status, 'open');
  });

  test('route plans put each pickup before its drop-off', async () => {
    const placed = await openJob();
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    const plans = await outboxEvents(ctx, 'route.plan');
    assert.ok(plans.some((row) => row.payload.driverId === driver.uid));
    await ctx.drainOutbox();
    const plan = await expectOk(
      driver.get<{ stops: { deliveryId: string; kind?: string }[] }>(`/routes/${driver.uid}`),
    );
    const stops = plan.stops.filter((stop) => stop.deliveryId === placed.deliveryId);
    const pickup = stops.findIndex((stop) => stop.kind === 'pickup');
    const dropoff = stops.findIndex((stop) => stop.kind === 'dropoff');
    assert.ok(pickup >= 0 && dropoff > pickup, JSON.stringify(plan.stops));
  });

  test('boost raises the payout on the delivery and the offer card', async () => {
    const placed = await openJob();
    const before = await offerRow(ctx, placed.deliveryId);
    await expectOk(world.dispatcher.call('boostJobPayout', { deliveryId: placed.deliveryId, addCents: 500 }));
    const offer = await offerRow(ctx, placed.deliveryId);
    assert.equal(offer?.payoutCents, before!.payoutCents + 500);
    assert.equal((await deliveryRow(ctx, placed.deliveryId)).payout?.boostCents, 500);
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    await expectError(
      world.dispatcher.call('boostJobPayout', { deliveryId: placed.deliveryId, addCents: 500 }),
      'failed-precondition',
    );
  });

  test('a rejected store order cancels its delivery and deletes the offer; the claimed driver is told', async () => {
    const placed = await openJob();
    const driver = await newDriver(ctx, { capacityClass: 'pickup' });
    await expectOk(driver.call('claimJob', { deliveryId: placed.deliveryId }));
    await expectOk(
      world.owner.call('rejectStoreOrder', {
        storeOrderId: placed.storeOrderId,
        expectedVersion: await versionOf(world.owner, placed.storeOrderId),
        reason: 'out_of_stock',
      }),
    );
    const delivery = await deliveryRow(ctx, placed.deliveryId);
    assert.equal(delivery.status, 'cancelled');
    assert.equal(delivery.offerStatus, 'withdrawn');
    const told = await ctx.pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND dedupe_key = $2`, [
      driver.uid,
      `job-cancelled-${placed.deliveryId}`,
    ]);
    assert.equal(told.rowCount, 1);
  });
});
