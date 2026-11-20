/**
 * Delivery workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3, owner `deliveries`): manual deliveries on
 * the new platform, port of legacy/firebase/tests/delivery-workflow.test.ts without COD and with +1 numbers.
 * createDeliveries (row errors, pre-assigned drivers, the 4-job limit) → accept → picked up → on the way
 * (tracking link once) → arrived → hand-off code → delivered; decline and reassign; only one trip in transit
 * per driver, also when two devices start two trips at once; staff completion, failure and re-attempt;
 * the staff edit; stats; tracking and route plans; driver sign-up, approval and vehicle review;
 * markStaleDriversOffline.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  CreateDeliveriesResponse,
  Delivery,
  DeliveryEvent,
  DeliveryStats,
  Page,
  PublicTracking,
} from '@instasupply/shared';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newRolelessUser,
  type ActorClient,
} from '../support/actors';
import { MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { expectError, expectOk } from '../support/http';
import { outboxEvents } from '../support/outbox';
import { race } from '../support/race';

const row = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Jordan Lee',
  customerPhone: '+14165550142',
  customerEmail: null,
  address: '200 Queens Quay W, Toronto',
  location: { lat: 43.6389, lng: -79.3817 },
  addressNotes: 'Loading dock B',
  notes: null,
  packageCount: 2,
  priority: 'normal',
  requireCode: false,
  driverId: null,
  windowStart: null,
  windowEnd: null,
  ...overrides,
});

describe('manual delivery workflow (MARKETPLACE §13.3, PLATFORM §9.2.6, §9.2.7, §9.2.13)', () => {
  let ctx: TestContext;
  let dispatch: ActorClient;
  let marco: ActorClient;
  let devon: ActorClient;

  const create = async (rows: Record<string, unknown>[]) =>
    expectOk(dispatch.call<CreateDeliveriesResponse>('createDeliveries', { deliveries: rows }));
  const createOne = async (overrides: Record<string, unknown> = {}) =>
    (await create([row(overrides)])).created[0]!;
  const deliveryOf = (actor: ActorClient, id: string) => expectOk(actor.get<Delivery>(`/deliveries/${id}`));
  const move = (
    actor: ActorClient,
    deliveryId: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) => actor.call<{ status: string }>('updateDeliveryStatus', { deliveryId, status, ...extra });
  const tracking = async (token: string) => {
    const answer = await ctx.app.inject({ method: 'GET', url: `/api/v1/tracking/${token}` });
    assert.equal(answer.statusCode, 200, answer.body);
    return JSON.parse(answer.body) as PublicTracking;
  };

  before(async () => {
    // No network in tests: a row without a pin is refused instead of geocoded.
    ctx = await createTestContext({ env: { GEOCODER: 'none' } });
    dispatch = await newDispatcher(ctx);
    marco = await newDriver(ctx, { displayName: 'Marco Rossi', capacityClass: 'cargo_van' });
    devon = await newDriver(ctx, { displayName: 'Devon Clarke', capacityClass: 'cargo_van' });
  });
  after(() => ctx.close());

  test('createDeliveries reports bad rows and creates the others, with tracking and events', async () => {
    const result = await create([
      row({ driverId: marco.uid, requireCode: true }),
      row(),
      row({ customerName: '' }),
      row({ location: null }),
      row({ driverId: 'nobody' }),
    ]);
    assert.deepEqual(
      result.created.map((created) => created.index),
      [0, 1],
    );
    assert.deepEqual(
      result.errors.map((error) => error.index),
      [2, 3, 4],
    );
    assert.match(result.created[0]!.orderId, /^IS-\d{5}$/);
    const first = await deliveryOf(dispatch, result.created[0]!.id);
    assert.equal(first.kind, 'manual');
    assert.equal(first.status, 'assigned');
    assert.equal(first.driverId, marco.uid);
    assert.equal(first.payout, null);
    const page = await tracking(result.created[0]!.trackingToken);
    assert.equal(page.status, 'assigned');
    assert.equal(page.customerFirstName, 'Jordan');
    const events = await expectOk(dispatch.get<Page<DeliveryEvent>>(`/deliveries/${first.id}/events`));
    assert.deepEqual(
      events.items.map((event) => event.type),
      ['assigned', 'created'],
    );
    await expectError(devon.call('createDeliveries', { deliveries: [row()] }), 'permission-denied');
  });

  test('the trip: accept, picked up, on the way (tracking link once), arrived, hand-off code, delivered', async () => {
    const created = await createOne({ driverId: marco.uid, requireCode: true });
    const id = created.id;
    await expectOk(move(marco, id, 'accepted'));
    await expectOk(move(marco, id, 'accepted'));
    await expectOk(move(marco, id, 'picked_up'));
    ctx.clock.advance(MINUTE);
    await expectOk(move(marco, id, 'in_transit', { location: { lat: 43.65, lng: -79.39 } }));
    const page = await tracking(created.trackingToken);
    assert.equal(page.status, 'in_transit');
    assert.equal(page.driver?.firstName, 'Marco');
    const sms = (await outboxEvents(ctx, 'sms.send')).filter((event) =>
      String(event.payload.body).includes(created.orderId),
    );
    assert.equal(sms.length, 1);
    assert.match(String(sms[0]!.payload.body), new RegExp(`/track/${created.trackingToken}$`));
    const events = await expectOk(dispatch.get<Page<DeliveryEvent>>(`/deliveries/${id}/events`));
    assert.ok(events.items.some((event) => event.type === 'customer_notified'));

    await expectOk(move(marco, id, 'arrived'));
    await expectError(marco.call('completeDelivery', { deliveryId: id }), 'invalid-argument');
    const error = await expectError(
      marco.call('completeDelivery', { deliveryId: id, recipientName: 'Jordan', handoffCode: '99999' }),
      'invalid-argument',
      'CODE_INCORRECT',
    );
    assert.equal(error.details.remaining, 4);
    await expectError(marco.get(`/deliveries/${id}/private`), 'permission-denied');
    const { handoffCode } = await expectOk(
      dispatch.get<{ handoffCode: string }>(`/deliveries/${id}/private`),
    );
    assert.equal((await tracking(created.trackingToken)).handoffCode, handoffCode);
    await expectOk(marco.call('completeDelivery', { deliveryId: id, recipientName: 'Jordan', handoffCode }));
    await expectOk(marco.call('completeDelivery', { deliveryId: id, recipientName: 'Jordan', handoffCode }));
    const done = await deliveryOf(dispatch, id);
    assert.equal(done.status, 'delivered');
    assert.deepEqual(done.proof?.codeVerified, true);
    assert.equal((await tracking(created.trackingToken)).status, 'delivered');

    // Moving the trip again is refused; the same status answers without writing.
    await expectError(move(marco, id, 'in_transit'), 'failed-precondition');
    await expectOk(move(marco, id, 'delivered'));

    const stats = await expectOk(
      marco.get<DeliveryStats>(`/deliveries/stats?since=${ctx.clock.now() - MINUTE * 60}`),
    );
    assert.equal(stats.delivered, 1);
  });

  test('a driver declines with a reason; staff are told; dispatch reassigns', async () => {
    const { id } = await createOne({ driverId: marco.uid });
    await expectError(move(marco, id, 'unassigned'), 'invalid-argument');
    await expectOk(move(marco, id, 'unassigned', { declineReason: 'too_far' }));
    const declined = await deliveryOf(dispatch, id);
    assert.equal(declined.status, 'unassigned');
    assert.equal(declined.driverId, null);
    assert.deepEqual(declined.declinedBy, [marco.uid]);
    const told = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'delivery_declined'`,
      [dispatch.uid],
    );
    assert.ok((told.rowCount ?? 0) >= 1);
    await expectError(marco.get(`/deliveries/${id}`), 'permission-denied');

    await expectOk(dispatch.call('assignDelivery', { deliveryId: id, driverId: devon.uid, note: 'closer' }));
    await expectOk(dispatch.call('assignDelivery', { deliveryId: id, driverId: devon.uid }));
    const reassigned = await deliveryOf(devon, id);
    assert.equal(reassigned.status, 'assigned');
    assert.equal(reassigned.driverName, 'Devon Clarke');
    const assigned = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'delivery_assigned'`,
      [devon.uid],
    );
    assert.equal(assigned.rowCount, 1);

    const pending = await newDriver(ctx, { status: 'pending' });
    await expectError(
      dispatch.call('assignDelivery', { deliveryId: id, driverId: pending.uid }),
      'failed-precondition',
    );
    await expectError(
      pending.call('updateDeliveryStatus', { deliveryId: id, status: 'accepted' }),
      'permission-denied',
    );
  });

  test('only one trip is on the way per driver: starting another parks the first', async () => {
    const driver = await newDriver(ctx);
    const a = await createOne({ driverId: driver.uid });
    const b = await createOne({ driverId: driver.uid });
    for (const id of [a.id, b.id]) {
      await expectOk(move(driver, id, 'accepted'));
      await expectOk(move(driver, id, 'picked_up'));
    }
    await expectOk(move(driver, a.id, 'in_transit'));
    await expectOk(move(driver, b.id, 'in_transit'));
    assert.equal((await deliveryOf(driver, a.id)).status, 'picked_up');
    assert.equal((await deliveryOf(driver, b.id)).status, 'in_transit');
    const events = await expectOk(driver.get<Page<DeliveryEvent>>(`/deliveries/${a.id}/events`));
    assert.equal(events.items[0]!.actorRole, 'system');
    assert.match(events.items[0]!.message, /paused/);
  });

  test('parked trips: two devices of one driver start two trips at once; at most one is on the way', async () => {
    await race({
      times: 10,
      setup: async () => {
        const driver = await newDriver(ctx);
        const ids: string[] = [];
        for (let i = 0; i < 2; i += 1) {
          const { id } = await createOne({ driverId: driver.uid });
          await expectOk(move(driver, id, 'accepted'));
          await expectOk(move(driver, id, 'picked_up'));
          ids.push(id);
        }
        return { driver, ids };
      },
      run: ({ driver, ids }) => ids.map((id) => () => move(driver, id, 'in_transit')),
      check: async (answers, { driver, ids }) => {
        for (const answer of answers) assert.equal(answer.status, 200, JSON.stringify(answer.body));
        const { rows } = await ctx.pool.query<{ status: string }>(
          'SELECT status FROM deliveries WHERE id = ANY($1::text[]) ORDER BY id',
          [ids],
        );
        assert.equal(rows.filter((r) => r.status === 'in_transit').length, 1, JSON.stringify(rows));
        assert.equal(rows.filter((r) => r.status === 'picked_up').length, 1, JSON.stringify(rows));
        void driver;
      },
    });
  });

  test('staff: failure needs a reason; re-attempt with the goods on the truck; completion by dispatch', async () => {
    const { id } = await createOne({ driverId: marco.uid });
    await expectOk(move(marco, id, 'accepted'));
    await expectOk(move(marco, id, 'picked_up'));
    await expectOk(move(marco, id, 'in_transit'));
    await expectError(move(marco, id, 'failed'), 'invalid-argument');
    await expectOk(move(marco, id, 'failed', { failureReason: 'no_one_on_site', note: 'Called twice' }));
    const failed = await deliveryOf(dispatch, id);
    assert.equal(failed.failure?.reason, 'no_one_on_site');
    assert.ok(
      (
        await ctx.pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'delivery_failed'`, [
          dispatch.uid,
        ])
      ).rowCount,
    );
    await expectOk(move(dispatch, id, 'picked_up'));
    const retried = await deliveryOf(dispatch, id);
    assert.equal(retried.attempts, 1);
    assert.equal(retried.failure, null);
    await expectOk(move(dispatch, id, 'delivered', { note: 'Signed paper slip' }));
    const done = await deliveryOf(dispatch, id);
    assert.equal(done.status, 'delivered');
    assert.equal(done.proof?.note, 'Signed paper slip');
    await expectError(move(marco, id, 'assigned'), 'invalid-argument');
  });

  test('the staff edit writes an event and tells the driver; only the editable keys', async () => {
    const { id } = await createOne({ driverId: marco.uid });
    ctx.clock.advance(MINUTE);
    const edited = await expectOk(
      dispatch.patch<Delivery>(`/deliveries/${id}`, { address: '1 Yonge St, Toronto', notes: 'Call first' }),
    );
    assert.equal(edited.address, '1 Yonge St, Toronto');
    const events = await expectOk(dispatch.get<Page<DeliveryEvent>>(`/deliveries/${id}/events`));
    assert.equal(events.items[0]!.type, 'edited');
    const told = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'delivery_updated' AND dedupe_key LIKE $2`,
      [marco.uid, `dl-edited-${id}-%`],
    );
    assert.equal(told.rowCount, 1);
    await expectError(dispatch.patch(`/deliveries/${id}`, { status: 'delivered' }), 'invalid-argument');
    await expectError(dispatch.patch(`/deliveries/${id}`, { driverId: devon.uid }), 'invalid-argument');
    await expectError(dispatch.patch(`/deliveries/${id}`, { priority: 'asap' }), 'invalid-argument');
    await expectError(marco.patch(`/deliveries/${id}`, { notes: 'mine' }), 'permission-denied');
  });

  test('a pre-assigned driver with 4 active jobs gets no fifth one; route plans follow the stops', async () => {
    const driver = await newDriver(ctx);
    const result = await create([1, 2, 3, 4, 5].map(() => row({ driverId: driver.uid })));
    assert.equal(result.created.length, 4);
    assert.deepEqual(
      result.errors.map((error) => error.index),
      [4],
    );
    await ctx.drainOutbox();
    const plan = await expectOk(driver.get<{ stops: { deliveryId: string }[] }>(`/routes/${driver.uid}`));
    assert.equal(plan.stops.length, 4);
    const customer = await newCustomer(ctx);
    await expectError(customer.get(`/routes/${driver.uid}`), 'permission-denied');
  });
  test('a driver signs up (pending), is approved after the compliance checks, and changes vehicle through review', async () => {
    const admin = await newAdmin(ctx);
    const user = await newRolelessUser(ctx);
    const vehicle = {
      type: 'pickup',
      make: 'Ford',
      model: 'F-150',
      year: 2021,
      plate: 'CBKX 214',
      colour: 'grey',
      boxLengthFt: 6.5,
      payloadKg: null,
      extras: [],
    };
    const signup = {
      displayName: 'Aisha Khan',
      cityId: 'mississauga',
      vehicle,
      attestations: { licence: true, insurance: true, terms: true },
    };
    await expectError(
      user.call('registerDriver', {
        ...signup,
        attestations: { licence: true, insurance: false, terms: true },
      }),
      'invalid-argument',
    );
    await expectError(
      user.call('registerDriver', { ...signup, vehicle: { ...vehicle, year: 1980 } }),
      'invalid-argument',
    );
    assert.deepEqual(await expectOk(user.call('registerDriver', signup)), { status: 'pending' });
    assert.deepEqual(await expectOk(user.call('registerDriver', { ...signup, cityId: 'brampton' })), {
      status: 'pending',
    });
    const me = await expectOk(
      user.get<{ profile: { role: string; cityId: string; vehicle: { capacityClass: string } } }>('/me'),
    );
    assert.equal(me.profile.role, 'driver');
    assert.equal(me.profile.cityId, 'brampton');
    assert.equal(me.profile.vehicle.capacityClass, 'pickup');
    const signups = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'driver_signup'`,
      [admin.uid],
    );
    assert.equal(signups.rowCount, 1);
    await expectError(user.get('/job-offers'), 'permission-denied');

    await expectError(
      admin.call('setDriverStatus', { uid: user.uid, status: 'active' }),
      'failed-precondition',
    );
    await expectOk(
      admin.call('setDriverStatus', {
        uid: user.uid,
        status: 'active',
        licenceVerified: true,
        insuranceVerified: true,
      }),
    );
    await expectOk(admin.call('setDriverStatus', { uid: user.uid, status: 'active' }));
    const approved = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'account_approved'`,
      [user.uid],
    );
    assert.equal(approved.rowCount, 1);
    await expectOk(user.get('/job-offers'));
    // After approval a repeat only renames.
    assert.deepEqual(await expectOk(user.call('registerDriver', { ...signup, displayName: 'Aisha K.' })), {
      status: 'active',
    });

    await expectOk(
      user.call('updateDriverVehicle', {
        vehicle: { ...vehicle, type: 'box_truck', boxLengthFt: null, model: 'E-450' },
      }),
    );
    const draft = await expectOk(
      user.get<{
        profile: {
          vehicleReviewRequired: boolean;
          vehicleDraft: { capacityClass: string };
          vehicle: { capacityClass: string };
        };
      }>('/me'),
    );
    assert.equal(draft.profile.vehicleReviewRequired, true);
    assert.equal(draft.profile.vehicleDraft.capacityClass, 'box_truck');
    assert.equal(draft.profile.vehicle.capacityClass, 'pickup');
    await expectOk(admin.call('reviewDriverVehicle', { uid: user.uid, approve: true }));
    await expectError(
      admin.call('reviewDriverVehicle', { uid: user.uid, approve: true }),
      'failed-precondition',
    );
    const { rows } = await ctx.pool.query<{ capacity_class: string }>(
      'SELECT capacity_class FROM users WHERE id = $1',
      [user.uid],
    );
    assert.equal(rows[0]!.capacity_class, 'box_truck');
  });

  test('markStaleDriversOffline turns drivers without a fix for 10 minutes offline', async () => {
    const stale = await newDriver(ctx);
    await ctx.pool.query('UPDATE driver_locations SET updated_at = $2, online = true WHERE driver_id = $1', [
      stale.uid,
      new Date(ctx.clock.now() - 11 * MINUTE),
    ]);
    const fresh = await newDriver(ctx);
    await ctx.pool.query('UPDATE driver_locations SET updated_at = $2, online = true WHERE driver_id = $1', [
      fresh.uid,
      new Date(ctx.clock.now()),
    ]);
    const result = await ctx.runJob('markStaleDriversOffline');
    assert.ok(result.offline! >= 1);
    const { rows } = await ctx.pool.query<{ driver_id: string; online: boolean }>(
      'SELECT driver_id, online FROM driver_locations WHERE driver_id = ANY($1::text[])',
      [[stale.uid, fresh.uid]],
    );
    const online = new Map(rows.map((r) => [r.driver_id, r.online]));
    assert.equal(online.get(stale.uid), false);
    assert.equal(online.get(fresh.uid), true);
  });
});
