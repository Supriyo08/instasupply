/**
 * Tracking, routing, location and geocoding (docs/PLATFORM.md §12.4 `tracking-routing.test.ts`, owner
 * `routing`): location reports (the 2-second rule, the online-change exemption, stale fixes), tracking field
 * ownership (a route plan computed before a delivery completed never writes status or phase; a delivered
 * trip never shows "On the way" again), ETA patches, route plans with pickup stops, the geocoder cache and the
 * provider limits, and that no provider call happens inside a transaction.
 *
 * Deliveries are written here the way a delivery transaction writes them (row lock, document, syncTracking),
 * so this file depends on nothing but the routing workstream and the platform.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  encodePolyline,
  type Delivery,
  type DeliveryStatus,
  type DriverLocation,
  type GeocodeAddressResponse,
  type LatLng,
  type LocationAck,
  type OptimizeRouteResponse,
  type PublicTracking,
  type RoutePlan,
  type WithId,
} from '@instasupply/shared';
import { withTransaction } from '../../src/platform/db/tx';
import { newId, newTrackingToken } from '../../src/platform/ids';
import { enqueue } from '../../src/platform/outbox/outbox';
import { syncTracking } from '../../src/modules/tracking';
import { newCustomer, newDispatcher, newDriver, type ActorClient } from '../support/actors';
import { SECOND, MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { command, expectError, expectOk, get } from '../support/http';
import { connectLive } from '../support/live';
import { outboxEvents } from '../support/outbox';
import { hold, race } from '../support/race';

// ---------- delivery rows, written as a delivery transaction writes them ----------

interface DeliveryOptions {
  driver?: ActorClient | null;
  status?: DeliveryStatus;
  location?: LatLng;
  marketplace?: { storeName: string; location: LatLng; collected?: boolean; arrived?: boolean };
  requireCode?: boolean;
}

interface CreatedDelivery {
  id: string;
  token: string;
  handoffCode: string;
}

const SITE: LatLng = { lat: 43.6648, lng: -79.3405 }; // Leslieville, Dana's jobsite
const STORE: LatLng = { lat: 43.6966, lng: -79.5752 }; // a store in Etobicoke

const STATUS_AT: Partial<Record<DeliveryStatus, keyof Delivery>> = {
  assigned: 'assignedAt',
  accepted: 'acceptedAt',
  picked_up: 'pickedUpAt',
  in_transit: 'startedAt',
  arrived: 'arrivedAt',
  delivered: 'deliveredAt',
  failed: 'failedAt',
  cancelled: 'cancelledAt',
};

let serial = 0;

function buildDelivery(ctx: TestContext, customerId: string, options: DeliveryOptions): Delivery {
  serial += 1;
  const now = ctx.clock.now();
  const status = options.status ?? (options.driver ? 'assigned' : 'unassigned');
  const market = options.marketplace ?? null;
  const delivery: Delivery = {
    id: newId(),
    kind: market ? 'marketplace' : 'manual',
    orderId: market ? `IS-${10000 + serial}-A` : `IS-${10000 + serial}`,
    storeOrderId: null,
    storeId: null,
    pickup: market
      ? {
          storeId: 'test-store',
          storeName: market.storeName,
          address: '100 Store Rd, Toronto ON',
          location: market.location,
          phone: '+14165550120',
          loadingNotes: null,
          readyBy: now + 15 * MINUTE,
          ready: true,
          readyAt: now,
          arrivedAt: market.arrived ? now : null,
          collectedAt: market.collected ? now : null,
          pickupCode: null,
        }
      : null,
    load: null,
    vehicleClass: market ? 'pickup' : null,
    tripKm: null,
    cityIds: ['toronto'],
    receiving: market ? 'attended' : null,
    requirePhoto: market !== null,
    unload: null,
    payout: null,
    offerStatus: market ? 'claimed' : null,
    offerOpensAt: null,
    releasedBy: {},
    customer: { name: 'Dana Whitfield', phone: '+14165550110' },
    address: 'Pape Ave & Dundas St E, Toronto ON M4M 2E3',
    location: options.location ?? SITE,
    addressNotes: null,
    notes: null,
    packageCount: 1,
    priority: 'normal',
    requireCode: options.requireCode ?? false,
    windowStart: null,
    windowEnd: now + 3 * 60 * MINUTE,
    driverId: options.driver?.uid ?? null,
    driverName: options.driver ? 'Marco Bellini' : null,
    status,
    attempts: 0,
    sourceOrderId: null,
    customerId,
    proof: null,
    failure: null,
    createdBy: customerId,
    updatedBy: customerId,
    createdAt: now,
    updatedAt: now,
  };
  const field = STATUS_AT[status];
  if (field) (delivery as unknown as Record<string, unknown>)[field] = now;
  return delivery;
}

async function createDelivery(
  ctx: TestContext,
  customerId: string,
  options: DeliveryOptions = {},
): Promise<CreatedDelivery> {
  const delivery = buildDelivery(ctx, customerId, options);
  const meta = {
    trackingToken: newTrackingToken(),
    handoffCode: '4821',
    codeAttempts: 0,
    trackingLinkSentAt: null,
  };
  const { id, createdAt, updatedAt, ...doc } = delivery;
  await withTransaction(ctx.deps, async (tx) => {
    await tx.query(
      `INSERT INTO deliveries (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
      [id, JSON.stringify(doc), JSON.stringify(meta), new Date(createdAt), new Date(updatedAt)],
    );
    await syncTracking(tx, delivery);
  });
  return { id, token: meta.trackingToken, handoffCode: meta.handoffCode };
}

/** A delivery transaction: lock the row, write the document, project the tracking fields it owns. */
async function updateDelivery(
  ctx: TestContext,
  id: string,
  change: (delivery: Delivery) => Partial<Delivery>,
): Promise<Delivery> {
  return withTransaction(ctx.deps, async (tx) => {
    const { rows } = await tx.query<{ doc: Omit<Delivery, 'id'>; created_at: number }>(
      'SELECT doc, created_at FROM deliveries WHERE id = $1 FOR NO KEY UPDATE',
      [id],
    );
    const current = { ...rows[0]!.doc, id, createdAt: rows[0]!.created_at, updatedAt: tx.now } as Delivery;
    const next: Delivery = { ...current, ...change(current), updatedAt: tx.now };
    const { id: _id, createdAt: _c, updatedAt: _u, ...doc } = next;
    await tx.query('UPDATE deliveries SET doc = $2::jsonb, updated_at = $3 WHERE id = $1', [
      id,
      JSON.stringify(doc),
      new Date(tx.now),
    ]);
    await syncTracking(tx, next);
    return next;
  });
}

const moveTo =
  (status: DeliveryStatus) =>
  (delivery: Delivery): Partial<Delivery> => {
    const field = STATUS_AT[status];
    return { status, ...(field ? { [field]: delivery.updatedAt } : {}) };
  };

async function tracking(ctx: TestContext, token: string): Promise<PublicTracking> {
  return expectOk(get<PublicTracking>(ctx, `/tracking/${token}`));
}

// ---------- providers: a recording fetch instead of the network ----------

interface ProviderCall {
  url: string;
  headers: Record<string, string>;
  /** Connections of the test database that sat inside an open transaction while the call ran. */
  openTransactions: number;
}

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Replaces `fetch` with a provider double. Each call records whether any connection of this test's database
 * was inside a transaction at that moment: the assertion behind "no provider call inside a transaction".
 */
function recordProviders(
  ctx: TestContext,
  answer: (url: URL) => Response | Promise<Response>,
): ProviderCall[] {
  const calls: ProviderCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const { rows } = await ctx.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`,
    );
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: url.href, headers, openTransactions: rows[0]!.n });
    return answer(url);
  }) as typeof fetch;
  return calls;
}

/** An OSRM double: table → straight-line-ish numbers, route → a polyline through the points. */
function osrm(url: URL, live: { duration: number; distance: number } = { duration: 600, distance: 5000 }) {
  const coordinates = url.pathname.split('/').pop()!.split(';');
  const points = coordinates.map((pair) => {
    const [lng, lat] = pair.split(',').map(Number);
    return { lat: lat!, lng: lng! };
  });
  if (url.pathname.includes('/table/')) {
    const n = points.length;
    const durations = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : 300 + 10 * (i + j))),
    );
    const distances = durations.map((row) => row.map((s) => s * 10));
    return json({ code: 'Ok', durations, distances });
  }
  return json({ code: 'Ok', routes: [{ geometry: encodePolyline(points), ...live }] });
}

async function freeProviderSlots(ctx: TestContext): Promise<void> {
  await ctx.pool.query(`DELETE FROM rate_limits WHERE bucket LIKE 'provider_%'`);
}

// ---------- the file ----------

let ctx: TestContext;
let customer: ActorClient;
let dispatcher: ActorClient;
let marco: ActorClient;

const fix = (point: LatLng, at: number, extra: Partial<{ heading: number }> = {}) => ({
  lat: point.lat,
  lng: point.lng,
  heading: extra.heading ?? null,
  speed: 10,
  accuracy: 8,
  at,
});

/** Moves `meters` north of a point (1° of latitude ≈ 111 195 m). */
const north = (point: LatLng, meters: number): LatLng => ({
  lat: point.lat + meters / 111_195,
  lng: point.lng,
});

async function report(
  driver: ActorClient,
  body: { online?: boolean; fixes: ReturnType<typeof fix>[]; battery?: number | null },
) {
  return driver.post<LocationAck>('/me/location', {
    online: body.online ?? true,
    mode: 'live',
    battery: body.battery ?? null,
    fixes: body.fixes,
  });
}

before(async () => {
  ctx = await createTestContext();
  customer = await newCustomer(ctx, { displayName: 'Dana Whitfield' });
  dispatcher = await newDispatcher(ctx);
  marco = await newDriver(ctx, {
    displayName: 'Marco Bellini',
    capacityClass: 'pickup',
    vehicle: { capacityClass: 'pickup', make: 'Ford', model: 'F-150', plate: 'CBKX 214' },
    position: { lat: 43.7, lng: -79.56 },
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  await ctx.close();
});

beforeEach(() => {
  globalThis.fetch = realFetch;
  ctx.config.ROUTING_PROVIDER = 'auto';
  ctx.config.GEOCODER = 'auto';
  // Every test starts more than the 2-second window after the last report.
  ctx.clock.advance(5 * SECOND);
});

describe('POST /me/location', () => {
  test('keeps the newest fix of a report with the server time and answers the ack', async () => {
    const t = ctx.clock.now();
    const a = { lat: 43.701, lng: -79.561 };
    const b = { lat: 43.702, lng: -79.562 };
    const ack = await expectOk(
      report(marco, { fixes: [fix(a, t - 2000), fix(b, t - 500, { heading: 90 })], battery: 0.8 }),
    );
    assert.deepEqual(ack, { online: true, serverTime: t });
    const location = await expectOk(marco.get<WithId<DriverLocation>>(`/driver-locations/${marco.uid}`));
    assert.equal(location.id, marco.uid);
    assert.equal(location.lat, b.lat);
    assert.equal(location.lng, b.lng);
    assert.equal(location.heading, 90);
    assert.equal(location.battery, 0.8);
    assert.equal(location.online, true);
    assert.equal(location.updatedAt, t, 'updatedAt is the server clock, not the device time');
    const page = await expectOk(dispatcher.get<{ items: WithId<DriverLocation>[] }>('/driver-locations'));
    assert.ok(page.items.some((item) => item.id === marco.uid && item.lat === b.lat));
  });

  test('the 2-second rule: a second report is RATE_LIMITED with retryAfterMs, then accepted', async () => {
    const t = ctx.clock.now();
    await expectOk(report(marco, { fixes: [fix(SITE, t)] }));
    ctx.clock.advance(1200);
    const refused = await expectError(report(marco, { fixes: [fix(SITE, t + 1200)] }), 429, 'RATE_LIMITED');
    assert.equal(refused.details.retryAfterMs, 800);
    ctx.clock.advance(800);
    await expectOk(report(marco, { fixes: [fix(SITE, t + 2000)] }));
  });

  test('a report that changes online is always accepted; going offline needs no fix', async () => {
    const t = ctx.clock.now();
    await expectOk(report(marco, { fixes: [fix(SITE, t)] }));
    ctx.clock.advance(300);
    const offline = await expectOk(report(marco, { online: false, fixes: [] }));
    assert.equal(offline.online, false);
    ctx.clock.advance(300);
    await expectError(report(marco, { online: false, fixes: [] }), 429, 'RATE_LIMITED');
    ctx.clock.advance(300);
    const back = await expectOk(report(marco, { online: true, fixes: [fix(SITE, ctx.clock.now())] }));
    assert.equal(back.online, true);
    const location = await expectOk(marco.get<WithId<DriverLocation>>(`/driver-locations/${marco.uid}`));
    assert.equal(location.online, true);
  });

  test('fixes older than the stored position are ignored', async () => {
    const t = ctx.clock.now();
    const fresh = { lat: 43.71, lng: -79.57 };
    await expectOk(report(marco, { fixes: [fix(fresh, t)] }));
    ctx.clock.advance(3 * SECOND);
    // A queued batch delivered late: every fix was taken before the stored report arrived.
    await expectOk(report(marco, { fixes: [fix({ lat: 43.5, lng: -79.9 }, t - 10 * SECOND)] }));
    const location = await expectOk(marco.get<WithId<DriverLocation>>(`/driver-locations/${marco.uid}`));
    assert.equal(location.lat, fresh.lat);
    assert.equal(location.lng, fresh.lng);
    assert.equal(location.updatedAt, ctx.clock.now(), 'the driver is still alive');
  });

  test('validation: 1 to 20 fixes, none only offline, ranges, no unknown keys', async () => {
    const t = ctx.clock.now();
    const many = Array.from({ length: 21 }, (_, i) => fix(SITE, t - 21_000 + i * 1000));
    await expectError(report(marco, { fixes: many }), 400);
    await expectError(report(marco, { online: true, fixes: [] }), 400);
    await expectError(report(marco, { fixes: [fix({ lat: 91, lng: 0 }, t)] }), 400);
    await expectError(report(marco, { fixes: [fix({ lat: 43, lng: -181 }, t)] }), 400);
    await expectError(
      marco.post('/me/location', {
        online: true,
        mode: 'live',
        battery: null,
        fixes: [fix(SITE, t)],
        driverId: 'x',
      }),
      400,
    );
  });

  test('two reports at once: exactly one is accepted, the other is RATE_LIMITED', async () => {
    await race({
      times: 10,
      setup: async () => {
        ctx.clock.advance(3 * SECOND);
        return ctx.clock.now();
      },
      run: (t) => [
        () => report(marco, { fixes: [fix(SITE, t)] }),
        () => report(marco, { fixes: [fix(SITE, t)] }),
      ],
      check: (answers) => {
        const statuses = answers.map((answer) => answer.status).sort();
        assert.deepEqual(statuses, [200, 429]);
      },
    });
  });
});

describe('tracking', () => {
  test('syncTracking creates the public document; location syncs move the driver and the ETA', async () => {
    const start = north(SITE, 3000);
    await expectOk(report(marco, { fixes: [fix(start, ctx.clock.now())] }));
    const trip = await createDelivery(ctx, customer.uid, {
      driver: marco,
      status: 'assigned',
      requireCode: true,
    });
    let doc = await tracking(ctx, trip.token);
    assert.equal(doc.status, 'assigned');
    assert.equal(doc.phase, 'driver_assigned');
    assert.equal(doc.customerFirstName, 'Dana');
    assert.equal(doc.handoffCode, trip.handoffCode);
    assert.deepEqual(doc.driver, {
      firstName: 'Marco',
      vehicle: 'Ford F-150 · CBKX 214',
      location: null,
      heading: null,
      updatedAt: null,
    });
    assert.equal(JSON.stringify(doc).includes('+1416'), false, 'no phone number on the public page');
    assert.equal(JSON.stringify(doc).includes('Bellini'), false, 'the driver is shown by first name only');

    // Entering the live phase seeds the position and the class-speed ETA.
    await updateDelivery(ctx, trip.id, moveTo('in_transit'));
    doc = await tracking(ctx, trip.token);
    assert.equal(doc.phase, 'to_site');
    assert.deepEqual(doc.driver?.location, start);
    assert.ok(typeof doc.etaSeconds === 'number' && doc.etaSeconds > 0);
    const firstEta = doc.etaSeconds;

    // 1 km closer: the tracking page follows, and the ETA shrinks.
    ctx.clock.advance(5 * SECOND);
    const closer = north(SITE, 2000);
    await expectOk(report(marco, { fixes: [fix(closer, ctx.clock.now(), { heading: 180 })] }));
    doc = await tracking(ctx, trip.token);
    assert.deepEqual(doc.driver?.location, closer);
    assert.equal(doc.driver?.heading, 180);
    assert.ok(doc.etaSeconds! < firstEta!);

    // GPS jitter (5 m, 3 s later) changes nothing on the page.
    ctx.clock.advance(3 * SECOND);
    const before = await tracking(ctx, trip.token);
    await expectOk(report(marco, { fixes: [fix(north(closer, 5), ctx.clock.now())] }));
    assert.deepEqual(await tracking(ctx, trip.token), before);
    // 20 s later the same small move is synced.
    ctx.clock.advance(21 * SECOND);
    await expectOk(report(marco, { fixes: [fix(north(closer, 6), ctx.clock.now())] }));
    assert.deepEqual((await tracking(ctx, trip.token)).driver?.location, north(closer, 6));

    // Arrived: ETA 0. Delivered: the live fields are cleared and the page never moves again.
    await updateDelivery(ctx, trip.id, moveTo('arrived'));
    assert.equal((await tracking(ctx, trip.token)).etaSeconds, 0);
    await updateDelivery(ctx, trip.id, moveTo('delivered'));
    doc = await tracking(ctx, trip.token);
    assert.equal(doc.phase, 'delivered');
    assert.equal(doc.driver?.location, null);
    assert.equal(doc.etaSeconds, null);
    ctx.clock.advance(30 * SECOND);
    await expectOk(report(marco, { fixes: [fix(north(SITE, 500), ctx.clock.now())] }));
    assert.deepEqual(await tracking(ctx, trip.token), doc);
    assert.deepEqual(
      doc.timeline.map((step) => step.status),
      ['unassigned', 'assigned', 'in_transit', 'arrived', 'delivered'],
    );
  });

  test('tracking.eta: enqueued once while due, writes the provider ETA, and is dropped after delivery', async () => {
    ctx.config.ROUTING_PROVIDER = 'osrm';
    await freeProviderSlots(ctx);
    const calls = recordProviders(ctx, (url) => osrm(url, { duration: 777, distance: 6100 }));
    const trip = await createDelivery(ctx, customer.uid, { driver: marco, status: 'in_transit' });

    ctx.clock.advance(25 * SECOND);
    await expectOk(report(marco, { fixes: [fix(north(SITE, 4000), ctx.clock.now())] }));
    ctx.clock.advance(25 * SECOND);
    await expectOk(report(marco, { fixes: [fix(north(SITE, 3500), ctx.clock.now())] }));
    const pending = (await outboxEvents(ctx, 'tracking.eta', 'pending')).filter(
      (row) => row.payload.deliveryId === trip.id,
    );
    assert.equal(pending.length, 1, 'coalesced on tracking.eta:{deliveryId} while pending');

    await ctx.drainOutbox();
    let doc = await tracking(ctx, trip.token);
    assert.equal(doc.etaSeconds, 777);
    assert.equal(doc.distanceMeters, 6100);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/route\/v1\/driving\//);
    assert.equal(calls[0]!.headers['user-agent'], ctx.config.GEO_USER_AGENT);

    // Within the minute the traffic-aware ETA is kept and no new provider call is enqueued.
    ctx.clock.advance(25 * SECOND);
    await expectOk(report(marco, { fixes: [fix(north(SITE, 3000), ctx.clock.now())] }));
    doc = await tracking(ctx, trip.token);
    assert.equal(doc.etaSeconds, 777);
    assert.equal((await outboxEvents(ctx, 'tracking.eta', 'pending')).length, 0);

    // After the minute one is due again; the trip is delivered before the handler runs: the result is dropped.
    ctx.clock.advance(40 * SECOND);
    await expectOk(report(marco, { fixes: [fix(north(SITE, 2500), ctx.clock.now())] }));
    assert.equal((await outboxEvents(ctx, 'tracking.eta', 'pending')).length, 1);
    await updateDelivery(ctx, trip.id, moveTo('delivered'));
    await ctx.drainOutbox();
    doc = await tracking(ctx, trip.token);
    assert.equal(doc.status, 'delivered');
    assert.equal(doc.phase, 'delivered');
    assert.equal(doc.etaSeconds, null);
    assert.ok(
      calls.every((call) => call.openTransactions === 0),
      'no provider call inside a transaction',
    );
  });
});

describe('live events', () => {
  test('tracking:{token} carries the whole document; driver-locations and the route topic follow', async () => {
    const driver = await newDriver(ctx, { displayName: 'Aisha Rahman', capacityClass: 'cargo_van' });
    const trip = await createDelivery(ctx, customer.uid, { driver, status: 'in_transit' });
    const page = await connectLive(ctx);
    const subscribed = await page.subscribe([`tracking:${trip.token}`]);
    assert.deepEqual(subscribed.denied, [], 'anyone holding the token may subscribe');
    const ops = await dispatcher.live();
    await ops.subscribe(['driver-locations', `driver:${driver.uid}:route`]);

    ctx.clock.advance(30 * SECOND);
    const position = north(SITE, 800);
    await expectOk(report(driver, { fixes: [fix(position, ctx.clock.now())] }));
    const event = await page.nextEvent(`tracking:${trip.token}`);
    const data = event.data as PublicTracking;
    assert.deepEqual(data.driver?.location, position);
    assert.equal(data.phase, 'to_site');
    assert.equal(data.updatedAt, ctx.clock.now());
    assert.equal('token' in data, false);
    const located = await ops.nextEvent('driver-locations');
    assert.equal((located.data as WithId<DriverLocation>).id, driver.uid);

    await expectOk(driver.call('optimizeRoute', {}));
    await ops.nextEvent(`driver:${driver.uid}:route`);
    page.close();
    ops.close();
  });
});

describe('route plans', () => {
  test('pickup stops: an uncollected job is a pickup then a drop-off; tracking gets stopsBefore', async () => {
    const driver = await newDriver(ctx, {
      displayName: 'Devon Clarke',
      capacityClass: 'box_truck',
      position: { lat: 43.65, lng: -79.45 },
    });
    const job = await createDelivery(ctx, customer.uid, {
      driver,
      status: 'accepted',
      marketplace: { storeName: 'Kestrel Lumber Yard', location: STORE },
    });
    const manual = await createDelivery(ctx, customer.uid, {
      driver,
      status: 'assigned',
      location: { lat: 43.6655, lng: -79.4636 },
    });

    const summary = await expectOk(driver.call<OptimizeRouteResponse>('optimizeRoute', {}));
    assert.equal(summary.stops, 3);
    assert.equal(summary.provider, 'estimate');
    const plan = await expectOk(driver.get<RoutePlan>(`/routes/${driver.uid}`));
    assert.equal(plan.driverId, driver.uid);
    assert.equal(plan.computedAt, ctx.clock.now());
    const kinds = plan.stops.map((stop) => `${stop.deliveryId === job.id ? 'job' : 'manual'}:${stop.kind}`);
    assert.deepEqual([...kinds].sort(), ['job:dropoff', 'job:pickup', 'manual:dropoff']);
    assert.ok(kinds.indexOf('job:pickup') < kinds.indexOf('job:dropoff'), 'the pickup comes first');
    const pickup = plan.stops.find((stop) => stop.kind === 'pickup')!;
    assert.equal(pickup.title, 'Kestrel Lumber Yard');
    assert.deepEqual(pickup.location, STORE);
    assert.equal(
      plan.stops.find((s) => s.deliveryId === job.id && s.kind === 'dropoff')!.title,
      'Dana Whitfield',
    );
    const jobTracking = await tracking(ctx, job.token);
    assert.equal(jobTracking.stopsBefore, kinds.indexOf('job:dropoff'));
    assert.equal((await tracking(ctx, manual.token)).stopsBefore, kinds.indexOf('manual:dropoff'));
    assert.equal(jobTracking.status, 'accepted', 'the planner never writes status');
    assert.equal(jobTracking.phase, 'to_store', 'the planner never writes phase');

    // Collected: one drop-off stop left for the job.
    ctx.clock.advance(20 * SECOND);
    await updateDelivery(ctx, job.id, (d) => ({
      ...moveTo('picked_up')(d),
      pickup: d.pickup ? { ...d.pickup, collectedAt: d.updatedAt } : null,
    }));
    await expectOk(dispatcher.call('optimizeRoute', { driverId: driver.uid }));
    const replanned = await expectOk(dispatcher.get<RoutePlan>(`/routes/${driver.uid}`));
    assert.equal(replanned.stops.length, 2);
    assert.ok(replanned.stops.every((stop) => stop.kind === 'dropoff'));
  });

  test('optimizeRoute: drivers plan their own route at most every 15 s; staff name a driver', async () => {
    const driver = await newDriver(ctx, { capacityClass: 'cargo_van' });
    await createDelivery(ctx, customer.uid, { driver, status: 'assigned' });
    await expectOk(driver.call('optimizeRoute', { origin: { lat: 43.66, lng: -79.4 } }));
    const first = await expectOk(driver.get<RoutePlan>(`/routes/${driver.uid}`));
    assert.deepEqual(first.origin, { lat: 43.66, lng: -79.4 });
    ctx.clock.advance(10 * SECOND);
    await expectOk(driver.call('optimizeRoute', {}));
    assert.equal(
      (await expectOk(driver.get<RoutePlan>(`/routes/${driver.uid}`))).computedAt,
      first.computedAt,
    );
    ctx.clock.advance(6 * SECOND);
    await expectOk(driver.call('optimizeRoute', {}));
    assert.equal(
      (await expectOk(driver.get<RoutePlan>(`/routes/${driver.uid}`))).computedAt,
      ctx.clock.now(),
    );

    await expectError(driver.call('optimizeRoute', { driverId: marco.uid }), 403);
    await expectError(dispatcher.call('optimizeRoute', {}), 400);
    await expectError(dispatcher.call('optimizeRoute', { driverId: customer.uid }), 404);
    await expectError(dispatcher.call('optimizeRoute', { driverId: driver.uid, extra: 1 }), 400);
  });

  test('route.plan recomputes from current rows and skips an unchanged signature', async () => {
    const driver = await newDriver(ctx, { capacityClass: 'suv' });
    const trip = await createDelivery(ctx, customer.uid, { driver, status: 'assigned' });
    const plan = async () => {
      await withTransaction(ctx.deps, (tx) =>
        enqueue(tx, 'route.plan', { driverId: driver.uid }, { dedupeKey: `route.plan:${driver.uid}` }),
      );
      await ctx.drainOutbox();
      return expectOk(dispatcher.get<RoutePlan>(`/routes/${driver.uid}`));
    };
    const first = await plan();
    assert.equal(first.stops.length, 1);
    ctx.clock.advance(MINUTE);
    assert.equal((await plan()).computedAt, first.computedAt, 'same inputs: nothing recomputed');
    await updateDelivery(ctx, trip.id, moveTo('accepted'));
    ctx.clock.advance(MINUTE);
    const third = await plan();
    assert.equal(third.computedAt, ctx.clock.now());
    assert.equal(third.stops[0]!.status, 'accepted');
    await expectError(dispatcher.get(`/routes/${customer.uid}`), 404);
  });

  test('a plan computed before the delivery completed never writes status, phase or stopsBefore', async () => {
    ctx.config.ROUTING_PROVIDER = 'osrm';
    await freeProviderSlots(ctx);
    const calls = recordProviders(ctx, (url) => osrm(url));
    const driver = await newDriver(ctx, { capacityClass: 'pickup', position: north(SITE, 1500) });
    const trip = await createDelivery(ctx, customer.uid, { driver, status: 'in_transit' });
    const other = await createDelivery(ctx, customer.uid, { driver, status: 'assigned', location: STORE });

    const gate = hold(ctx, 'planRoute:beforeWrite');
    const planning = dispatcher.call<OptimizeRouteResponse>('optimizeRoute', { driverId: driver.uid });
    await gate.reached();
    // The trip completes while the plan (with the trip still "in transit") waits to be written.
    ctx.clock.advance(SECOND);
    await updateDelivery(ctx, trip.id, moveTo('delivered'));
    gate.release();
    const summary = await expectOk(planning);
    assert.equal(summary.provider, 'osrm');
    assert.equal(summary.stops, 2);

    const doc = await tracking(ctx, trip.token);
    assert.equal(doc.status, 'delivered');
    assert.equal(doc.phase, 'delivered');
    assert.equal(doc.stopsBefore, null, 'the stale plan did not patch the delivered trip');
    assert.notEqual(
      (await tracking(ctx, other.token)).stopsBefore,
      null,
      'the unchanged delivery was patched',
    );
    const { rows } = await ctx.pool.query<{ signature: string | null }>(
      'SELECT signature FROM routes WHERE driver_id = $1',
      [driver.uid],
    );
    assert.equal(
      rows[0]!.signature,
      null,
      'a stale plan keeps no signature, so the next route.plan recomputes',
    );
    assert.ok(calls.length >= 1);
    assert.ok(
      calls.every((call) => call.openTransactions === 0),
      'no provider call inside a transaction',
    );
    assert.ok(calls.every((call) => call.headers['user-agent'] === ctx.config.GEO_USER_AGENT));
  });

  test('a provider failure falls back to the estimate', async () => {
    ctx.config.ROUTING_PROVIDER = 'osrm';
    await freeProviderSlots(ctx);
    recordProviders(ctx, () => json({ code: 'Error' }, 500));
    const driver = await newDriver(ctx, { capacityClass: 'car' });
    await createDelivery(ctx, customer.uid, { driver, status: 'assigned' });
    const summary = await expectOk(
      dispatcher.call<OptimizeRouteResponse>('optimizeRoute', { driverId: driver.uid }),
    );
    assert.equal(summary.provider, 'estimate');
    assert.equal(summary.stops, 1);
  });
});

describe('geocoding', () => {
  const nominatimItem = {
    display_name: '1000 Queen Street East, Leslieville, Toronto, Ontario, M4M 1J8, Canada',
    lat: '43.6608',
    lon: '-79.3405',
    address: {
      house_number: '1000',
      road: 'Queen Street East',
      neighbourhood: 'Leslieville',
      city: 'Toronto',
      postcode: 'm4m 1j8',
    },
  };

  test('Nominatim: GTA bias, User-Agent, enriched results, and a cache hit costs no provider call', async () => {
    ctx.config.GEOCODER = 'nominatim';
    await freeProviderSlots(ctx);
    const calls = recordProviders(ctx, () => json([nominatimItem]));
    const answer = await expectOk(
      customer.call<GeocodeAddressResponse>('geocodeAddress', { query: '  1000 Queen St E  ' }),
    );
    assert.deepEqual(answer.results, [
      {
        label: nominatimItem.display_name,
        location: { lat: 43.6608, lng: -79.3405 },
        line1: '1000 Queen Street East',
        city: 'Toronto',
        postalCode: 'M4M 1J8',
        cityId: 'toronto',
        areaLabel: 'Leslieville',
      },
    ]);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('q'), '1000 Queen St E');
    assert.equal(url.searchParams.get('countrycodes'), 'ca');
    assert.equal(url.searchParams.get('bounded'), '1');
    assert.equal(url.searchParams.get('addressdetails'), '1');
    assert.equal(url.searchParams.get('viewbox'), '-80,44.15,-78.75,43.25');
    assert.equal(calls[0]!.headers['user-agent'], ctx.config.GEO_USER_AGENT);
    assert.equal(calls[0]!.openTransactions, 0);

    // The same search in other spelling, signed out: served from geocode_cache, no provider call, no slot.
    await ctx.pool.query(`UPDATE rate_limits SET count = 99 WHERE bucket = 'provider_nominatim'`);
    const again = await expectOk(
      command<GeocodeAddressResponse>(ctx, 'geocodeAddress', { query: '1000 QUEEN ST E' }, null),
    );
    assert.deepEqual(again.results, answer.results);
    assert.equal(calls.length, 1);
    const { rows } = await ctx.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM geocode_cache');
    assert.equal(rows[0]!.n, 1);
  });

  test('Nominatim: one request per second for all instances; no slot within 3 s is unavailable', async () => {
    ctx.config.GEOCODER = 'nominatim';
    await freeProviderSlots(ctx);
    const calls = recordProviders(ctx, () => json([]));
    const started = Date.now();
    await expectOk(customer.call('geocodeAddress', { query: 'Danforth Ave' }));
    await expectOk(customer.call('geocodeAddress', { query: 'Woodbine Ave' }));
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - started >= 500, 'the second search waited for the next one-second slot');

    // Another instance holds the slot for 10 s: the search gives up after 3 s, nothing is cached.
    await ctx.pool.query(
      `UPDATE rate_limits SET count = 99, expires_at = now() + interval '10 seconds' WHERE bucket = 'provider_nominatim'`,
    );
    const waited = Date.now();
    await expectError(customer.call('geocodeAddress', { query: 'Kingston Rd' }), 503);
    assert.ok(Date.now() - waited >= 2900);
    assert.equal(calls.length, 2);
  });

  test('geocodeAddress: at least 3 characters; GEOCODER=none answers nothing; anyone may search', async () => {
    ctx.config.GEOCODER = 'none';
    const calls = recordProviders(ctx, () => json([]));
    await expectError(customer.call('geocodeAddress', { query: ' ab ' }), 400);
    await expectError(customer.call('geocodeAddress', {}), 400);
    const anonymous = await expectOk(
      command<GeocodeAddressResponse>(ctx, 'geocodeAddress', { query: 'Pape Ave' }, null),
    );
    assert.deepEqual(anonymous.results, []);
    assert.equal(calls.length, 0);
  });
});

describe('geocode limit (RATE_LIMITS_DISABLED=false)', () => {
  let limited: TestContext;
  after(async () => {
    await limited?.close();
  });

  test('non-staff callers get 30 searches per hour; staff are not limited', async () => {
    limited = await createTestContext({ env: { RATE_LIMITS_DISABLED: 'false', GEOCODER: 'none' } });
    const user = await newCustomer(limited);
    const staff = await newDispatcher(limited);
    for (let i = 0; i < 30; i += 1) await expectOk(user.call('geocodeAddress', { query: `Pape Ave ${i}` }));
    const refused = await expectError(
      user.call('geocodeAddress', { query: 'Pape Ave 31' }),
      429,
      'RATE_LIMITED',
    );
    assert.ok(Number(refused.details.retryAfterMs) > 0);
    for (let i = 0; i < 31; i += 1) await expectOk(staff.call('geocodeAddress', { query: `Pape Ave ${i}` }));
    const { rows } = await limited.pool.query<{ subject: string }>(
      `SELECT subject FROM rate_limits WHERE bucket = 'geocode'`,
    );
    assert.deepEqual(
      rows.map((row) => row.subject),
      [user.uid],
    );
  });
});
