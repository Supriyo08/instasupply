/**
 * Tracking (docs/PLATFORM.md §12.4 `tracking.authz.test.ts`, MARKETPLACE §13.2; owner `routing`): anyone with
 * the token reads the public tracking document; there is no listing; an unknown token is not-found. Also the
 * routing endpoints this workstream serves (routes, driver locations, POST /me/location, optimizeRoute,
 * geocodeAddress) against every actor of MARKETPLACE §13.2.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Delivery, PublicTracking } from '@instasupply/shared';
import { withTransaction } from '../../src/platform/db/tx';
import { newId, newTrackingToken } from '../../src/platform/ids';
import { syncTracking } from '../../src/modules/tracking';
import { as, type ActorClient } from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { command, expectError, expectOk, get, post } from '../support/http';

let ctx: TestContext;
let token: string;
const actors: Record<string, ActorClient> = {};

const NAMES = [
  'dana',
  'sam',
  'kestrelOwner',
  'kestrelStaff',
  'bluestoneOwner',
  'marco',
  'gurpreet',
  'tom',
  'lena',
  'dispatcher',
  'admin',
] as const;
type Name = (typeof NAMES)[number];
const actor = (name: Name): ActorClient => actors[name]!;

/** One delivery of Dana's, assigned to Marco, with its tracking row (as a delivery transaction writes it). */
async function createTrackedDelivery(): Promise<string> {
  const now = ctx.clock.now();
  const dana = actor('dana');
  const marco = actor('marco');
  const delivery: Delivery = {
    id: newId(),
    kind: 'manual',
    orderId: 'IS-10001',
    storeOrderId: null,
    storeId: null,
    pickup: null,
    load: null,
    vehicleClass: null,
    tripKm: null,
    cityIds: ['toronto'],
    receiving: null,
    requirePhoto: false,
    unload: null,
    payout: null,
    offerStatus: null,
    offerOpensAt: null,
    releasedBy: {},
    customer: { name: 'Dana Whitfield', phone: '+14165550110' },
    address: 'Pape Ave & Dundas St E, Toronto ON M4M 2E3',
    location: { lat: 43.6648, lng: -79.3405 },
    addressNotes: 'Laneway access off Pape.',
    notes: 'internal dispatch note',
    packageCount: 1,
    priority: 'normal',
    requireCode: true,
    windowStart: null,
    windowEnd: now + 3_600_000,
    driverId: marco.uid,
    driverName: 'Marco Bellini',
    status: 'in_transit',
    attempts: 0,
    customerId: dana.uid,
    sourceOrderId: null,
    proof: null,
    failure: null,
    createdBy: dana.uid,
    updatedBy: dana.uid,
    createdAt: now,
    updatedAt: now,
    assignedAt: now,
    startedAt: now,
  };
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
  return meta.trackingToken;
}

before(async () => {
  ctx = await createTestContext();
  for (const name of NAMES) actors[name] = await as(ctx, name);
  token = await createTrackedDelivery();
});
after(() => ctx.close());

describe('tracking (MARKETPLACE §6.2 → PLATFORM §7.3)', () => {
  test('anyone with the token reads the same document, signed in or not', async () => {
    const anonymous = await expectOk(get<PublicTracking>(ctx, `/tracking/${token}`));
    assert.equal(anonymous.status, 'in_transit');
    assert.equal(anonymous.phase, 'to_site');
    for (const name of NAMES) {
      const seen = await expectOk(actor(name).get<PublicTracking>(`/tracking/${token}`));
      assert.deepEqual(seen, anonymous, name);
    }
  });

  test('the document carries no private data', async () => {
    const doc = await expectOk(get<PublicTracking>(ctx, `/tracking/${token}`));
    const text = JSON.stringify(doc);
    for (const secret of ['+14165550110', 'Whitfield', 'Bellini', 'internal dispatch note', 'Laneway', '@']) {
      assert.equal(text.includes(secret), false, `tracking contains ${secret}`);
    }
    assert.equal(doc.customerFirstName, 'Dana');
    assert.equal(doc.driver?.firstName, 'Marco');
    assert.equal('driverId' in doc || 'customerId' in doc || 'notes' in doc, false);
  });

  test('there is no listing; an unknown token is not-found; a malformed one is refused', async () => {
    for (const who of [null, actor('dana'), actor('dispatcher'), actor('admin')]) {
      const list = who ? await who.get('/tracking') : await get(ctx, '/tracking');
      assert.equal(list.status, 404, 'GET /tracking does not exist');
    }
    await expectError(get(ctx, '/tracking/AAAAAAAAAAAAAAAAAAAAAAAA'), 404);
    await expectError(actor('admin').get('/tracking/AAAAAAAAAAAAAAAAAAAAAAAA'), 404);
    await expectError(get(ctx, '/tracking/short'), 400);
    await expectError(get(ctx, `/tracking/${'a'.repeat(65)}`), 400);
    await expectError(get(ctx, `/tracking/${encodeURIComponent("x' OR '1'='1xxxx")}`), 400);
  });
});

describe('routes, driver locations, POST /me/location (PLATFORM §5.3.3, §5.3.5)', () => {
  const report = () => ({
    online: true,
    mode: 'normal',
    battery: null,
    fixes: [{ lat: 43.7, lng: -79.56, heading: null, speed: null, accuracy: 10, at: ctx.clock.now() }],
  });

  test('POST /me/location: active drivers only; pending drivers, customers, suppliers and staff are denied', async () => {
    ctx.clock.advance(5000);
    await expectOk(actor('marco').post('/me/location', report()));
    await expectOk(actor('tom').post('/me/location', report()));
    await expectError(post(ctx, '/me/location', report()), 401);
    for (const name of [
      'lena',
      'dana',
      'sam',
      'kestrelOwner',
      'kestrelStaff',
      'dispatcher',
      'admin',
    ] as const) {
      await expectError(actor(name).post('/me/location', report()), 403);
    }
  });

  test('a driver writes only their own location: the body cannot name another driver', async () => {
    ctx.clock.advance(5000);
    await expectError(actor('marco').post('/me/location', { ...report(), driverId: actor('tom').uid }), 400);
    const tom = await expectOk(
      actor('dispatcher').get<{ lat: number }>(`/driver-locations/${actor('tom').uid}`),
    );
    assert.equal(tom.lat, 43.7);
  });

  test('GET /driver-locations: staff only', async () => {
    for (const name of ['dispatcher', 'admin'] as const) {
      const page = await expectOk(actor(name).get<{ items: { id: string }[] }>('/driver-locations'));
      assert.ok(page.items.some((item) => item.id === actor('marco').uid));
    }
    await expectError(get(ctx, '/driver-locations'), 401);
    for (const name of ['marco', 'lena', 'dana', 'kestrelOwner'] as const) {
      await expectError(actor(name).get('/driver-locations'), 403);
    }
  });

  test('GET /driver-locations/{driverId}: staff and the driver themselves', async () => {
    const marco = actor('marco').uid;
    await expectOk(actor('marco').get(`/driver-locations/${marco}`));
    await expectOk(actor('dispatcher').get(`/driver-locations/${marco}`));
    await expectError(get(ctx, `/driver-locations/${marco}`), 401);
    for (const name of ['tom', 'gurpreet', 'dana', 'kestrelOwner', 'bluestoneOwner'] as const) {
      await expectError(actor(name).get(`/driver-locations/${marco}`), 403);
    }
    // A pending driver reads their own row (self); nobody has a row before the first fix.
    await expectOk(actor('lena').get(`/driver-locations/${actor('lena').uid}`));
    await expectError(actor('admin').get(`/driver-locations/${actor('dana').uid}`), 404);
  });

  test('optimizeRoute and GET /routes/{driverId}: staff for anyone, a driver for their own route', async () => {
    const marco = actor('marco').uid;
    await expectOk(actor('marco').call('optimizeRoute', {}));
    await expectOk(actor('dispatcher').call('optimizeRoute', { driverId: marco }));
    await expectError(actor('marco').call('optimizeRoute', { driverId: actor('tom').uid }), 403);
    await expectError(command(ctx, 'optimizeRoute', {}), 401);
    for (const name of ['lena', 'dana', 'kestrelOwner', 'kestrelStaff'] as const) {
      await expectError(actor(name).call('optimizeRoute', { driverId: marco }), 403);
    }

    await expectOk(actor('marco').get(`/routes/${marco}`));
    await expectOk(actor('admin').get(`/routes/${marco}`));
    await expectError(get(ctx, `/routes/${marco}`), 401);
    for (const name of [
      'tom',
      'gurpreet',
      'lena',
      'dana',
      'sam',
      'kestrelOwner',
      'bluestoneOwner',
    ] as const) {
      await expectError(actor(name).get(`/routes/${marco}`), 403);
    }
    await expectError(actor('tom').get(`/routes/${actor('tom').uid}`), 404);
  });

  test('geocodeAddress is public: signed out and every role may search', async () => {
    await expectOk(command(ctx, 'geocodeAddress', { query: 'Pape Ave' }));
    for (const name of NAMES) await expectOk(actor(name).call('geocodeAddress', { query: 'Pape Ave' }));
  });
});
