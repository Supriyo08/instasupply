/**
 * Authorization of deliveries, their events and private meta, routes and driver locations (docs/PLATFORM.md
 * §7.3, §12.4; MARKETPLACE §13.2), owner `deliveries`. Per endpoint one allowed and one denied case for the
 * actors of §13.2: anonymous, customers A and B, the owner and staff of store X, a supplier of store Y, the
 * assigned driver, another driver, a pending driver, a dispatcher, an admin. A driver sees only the
 * deliveries assigned to them and their events, never `private` (the hand-off code); only staff edit, and
 * only the editable keys; an approved driver writes only their own location, a pending driver cannot.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { CreateDeliveriesResponse, Delivery, DeliveryEvent, Page } from '@instasupply/shared';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { expectError, expectOk, request } from '../support/http';

describe('deliveries authorization (MARKETPLACE §13.2: deliveries, events, private, routes, driver locations)', () => {
  let ctx: TestContext;
  let admin: ActorClient;
  let dispatcher: ActorClient;
  let customerA: ActorClient;
  let customerB: ActorClient;
  let ownerX: ActorClient;
  let staffX: ActorClient;
  let supplierY: ActorClient;
  let driver: ActorClient;
  let otherDriver: ActorClient;
  let pendingDriver: ActorClient;
  let deliveryId: string;
  let nonStaff: ActorClient[];

  before(async () => {
    ctx = await createTestContext();
    admin = await newAdmin(ctx);
    dispatcher = await newDispatcher(ctx);
    customerA = await newCustomer(ctx);
    customerB = await newCustomer(ctx);
    ownerX = await newSupplier(ctx);
    staffX = await newSupplier(ctx, {
      storeId: (ownerX as ActorClient & { storeId: string }).storeId,
      storeRole: 'staff',
    });
    supplierY = await newSupplier(ctx);
    driver = await newDriver(ctx);
    otherDriver = await newDriver(ctx);
    pendingDriver = await newDriver(ctx, { status: 'pending' });
    nonStaff = [customerA, customerB, ownerX, staffX, supplierY];
    const created = await expectOk(
      dispatcher.call<CreateDeliveriesResponse>('createDeliveries', {
        deliveries: [
          {
            customerName: 'Jordan Lee',
            customerPhone: '+14165550142',
            customerEmail: null,
            address: '200 Queens Quay W, Toronto',
            location: { lat: 43.6389, lng: -79.3817 },
            addressNotes: null,
            notes: null,
            packageCount: 1,
            priority: 'normal',
            requireCode: true,
            driverId: driver.uid,
            windowStart: null,
            windowEnd: null,
          },
        ],
      }),
    );
    deliveryId = created.created[0]!.id;
  });
  after(() => ctx.close());

  test('GET /deliveries/{id} and its events: staff and the assigned driver; nobody else', async () => {
    for (const actor of [admin, dispatcher, driver]) {
      await expectOk(actor.get<Delivery>(`/deliveries/${deliveryId}`));
      await expectOk(actor.get<Page<DeliveryEvent>>(`/deliveries/${deliveryId}/events`));
    }
    for (const actor of [otherDriver, ...nonStaff, pendingDriver]) {
      await expectError(actor.get(`/deliveries/${deliveryId}`), 'permission-denied');
      await expectError(actor.get(`/deliveries/${deliveryId}/events`), 'permission-denied');
    }
    await expectError(request(ctx, 'GET', `/deliveries/${deliveryId}`), 'unauthenticated');
  });

  test('private meta (tracking token, hand-off code): staff only, never a driver', async () => {
    const meta = await expectOk(
      dispatcher.get<{ handoffCode: string; trackingToken: string }>(`/deliveries/${deliveryId}/private`),
    );
    assert.match(meta.handoffCode, /^\d{4}$/);
    for (const actor of [driver, otherDriver, ...nonStaff]) {
      await expectError(actor.get(`/deliveries/${deliveryId}/private`), 'permission-denied');
    }
    const own = await expectOk(driver.get<Record<string, unknown>>(`/deliveries/${deliveryId}`));
    assert.ok(!('handoffCode' in own) && !('trackingToken' in own));
  });

  test('GET /deliveries is scoped: a driver gets only their own rows; another driverId is refused', async () => {
    const own = await expectOk(driver.get<Page<Delivery>>('/deliveries'));
    assert.ok(own.items.length >= 1 && own.items.every((item) => item.driverId === driver.uid));
    const empty = await expectOk(otherDriver.get<Page<Delivery>>('/deliveries'));
    assert.equal(empty.items.length, 0);
    await expectError(otherDriver.get(`/deliveries?driverId=${driver.uid}`), 'permission-denied');
    await expectError(driver.get('/deliveries?kind=manual'), 'invalid-argument');
    const all = await expectOk(
      dispatcher.get<Page<Delivery>>(`/deliveries?driverId=${driver.uid}&kind=manual`),
    );
    assert.equal(all.items.length, 1);
    for (const actor of nonStaff) await expectError(actor.get('/deliveries'), 'permission-denied');
    await expectError(request(ctx, 'GET', '/deliveries'), 'unauthenticated');
  });

  test('GET /deliveries/stats: the driver for themselves, staff for anyone', async () => {
    await expectOk(driver.get(`/deliveries/stats?since=0`));
    await expectOk(dispatcher.get(`/deliveries/stats?driverId=${driver.uid}&since=0`));
    await expectError(
      otherDriver.get(`/deliveries/stats?driverId=${driver.uid}&since=0`),
      'permission-denied',
    );
    await expectError(customerA.get(`/deliveries/stats?since=0`), 'permission-denied');
  });

  test('GET /activity: staff only', async () => {
    const feed = await expectOk(dispatcher.get<Page<DeliveryEvent>>('/activity'));
    assert.ok(feed.items.length >= 1);
    for (const actor of [driver, ...nonStaff]) await expectError(actor.get('/activity'), 'permission-denied');
  });

  test('PATCH /deliveries/{id}: staff only, and only the editable keys', async () => {
    await expectOk(dispatcher.patch(`/deliveries/${deliveryId}`, { notes: 'Ring the bell' }));
    await expectOk(admin.patch(`/deliveries/${deliveryId}`, { packageCount: 3 }));
    for (const actor of [driver, otherDriver, ...nonStaff]) {
      await expectError(actor.patch(`/deliveries/${deliveryId}`, { notes: 'x' }), 'permission-denied');
    }
    for (const key of ['status', 'driverId', 'proof', 'payout', 'kind', 'createdBy', 'orderId']) {
      await expectError(dispatcher.patch(`/deliveries/${deliveryId}`, { [key]: null }), 'invalid-argument');
    }
    await expectError(
      dispatcher.patch(`/deliveries/${deliveryId}`, {
        unload: { status: 'booked', labourerName: 'A', labourerPhone: '+14165550100', fee: 1 },
      }),
      'invalid-argument',
    );
  });

  test('delivery commands: staff or the assigned driver; never another driver, a customer or a supplier', async () => {
    for (const actor of [otherDriver, ...nonStaff, pendingDriver]) {
      await expectError(
        actor.call('updateDeliveryStatus', { deliveryId, status: 'accepted' }),
        'permission-denied',
      );
      await expectError(
        actor.call('completeDelivery', { deliveryId, recipientName: 'X' }),
        'permission-denied',
      );
      await expectError(actor.call('checkInAtStore', { deliveryId }), 'permission-denied');
    }
    for (const actor of [driver, ...nonStaff]) {
      await expectError(
        actor.call('assignDelivery', { deliveryId, driverId: driver.uid }),
        'permission-denied',
      );
      await expectError(actor.call('createDeliveries', { deliveries: [{}] }), 'permission-denied');
      await expectError(
        actor.call('resolveFailedDelivery', { storeOrderId: 'x-A', action: 'reattempt' }),
        'permission-denied',
      );
    }
    await expectError(
      request(ctx, 'POST', '/call/updateDeliveryStatus', { deliveryId, status: 'accepted' }),
      'unauthenticated',
    );
    await expectOk(driver.call('updateDeliveryStatus', { deliveryId, status: 'accepted' }));
    await expectError(
      driver.call('updateDeliveryStatus', { deliveryId, status: 'accepted', senderRole: 'staff' }),
      'invalid-argument',
    );
  });

  test('routes: the driver reads their own plan, staff any; nobody else', async () => {
    await ctx.drainOutbox();
    await expectOk(driver.get(`/routes/${driver.uid}`));
    await expectOk(dispatcher.get(`/routes/${driver.uid}`));
    for (const actor of [otherDriver, ...nonStaff]) {
      await expectError(actor.get(`/routes/${driver.uid}`), 'permission-denied');
    }
  });

  test('driver locations: an approved driver writes their own; a pending driver cannot; staff read', async () => {
    ctx.clock.advance(3000); // past the 2-second rule of POST /me/location
    await expectOk(
      driver.post('/me/location', {
        online: true,
        mode: 'normal',
        battery: 0.8,
        fixes: [{ lat: 43.65, lng: -79.38, heading: null, speed: null, accuracy: 8, at: ctx.clock.now() }],
      }),
    );
    await expectError(
      pendingDriver.post('/me/location', {
        online: true,
        mode: 'normal',
        battery: null,
        fixes: [{ lat: 43.65, lng: -79.38, heading: null, speed: null, accuracy: 8, at: ctx.clock.now() }],
      }),
      'permission-denied',
    );
    await expectError(
      customerA.post('/me/location', { online: false, mode: 'normal', battery: null, fixes: [] }),
      'permission-denied',
    );
    await expectOk(dispatcher.get(`/driver-locations/${driver.uid}`));
    await expectOk(driver.get(`/driver-locations/${driver.uid}`));
    await expectError(otherDriver.get(`/driver-locations/${driver.uid}`), 'permission-denied');
    await expectOk(dispatcher.get('/driver-locations'));
    for (const actor of [driver, ...nonStaff])
      await expectError(actor.get('/driver-locations'), 'permission-denied');
  });

  test('driver accounts: registerDriver refuses other roles; vehicle review and status are admin-only', async () => {
    await expectError(
      customerA.call('registerDriver', {
        displayName: 'Not A Driver',
        cityId: 'toronto',
        vehicle: {
          type: 'cargo_van',
          make: 'Ford',
          model: 'Transit',
          year: 2022,
          plate: 'ABCD 123',
          colour: null,
          boxLengthFt: null,
          payloadKg: null,
          extras: [],
        },
        attestations: { licence: true, insurance: true, terms: true },
      }),
      'failed-precondition',
    );
    for (const actor of [dispatcher, driver, ...nonStaff]) {
      await expectError(
        actor.call('setDriverStatus', { uid: pendingDriver.uid, status: 'active' }),
        'permission-denied',
      );
      await expectError(
        actor.call('reviewDriverVehicle', { uid: driver.uid, approve: true }),
        'permission-denied',
      );
      await expectError(
        actor.patch(`/users/${driver.uid}/payout-account`, { payoutAccount: null }),
        'permission-denied',
      );
    }
    await expectError(pendingDriver.call('updateDriverVehicle', { vehicle: {} }), 'permission-denied');
    const profile = await expectOk(
      admin.patch<{ payoutAccount: unknown }>(`/users/${driver.uid}/payout-account`, {
        payoutAccount: { provider: 'test', accountRef: 'acct_123', label: 'RBC ••12' },
      }),
    );
    assert.deepEqual(profile.payoutAccount, { provider: 'test', accountRef: 'acct_123', label: 'RBC ••12' });
    await expectError(
      admin.patch(`/users/${customerA.uid}/payout-account`, { payoutAccount: null }),
      'failed-precondition',
    );
  });
});
