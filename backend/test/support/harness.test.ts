/** The harness's own tests (docs/PLATFORM.md §15.1, `harness` row): every helper of test/support works. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import type { MeResponse } from '@instasupply/shared';
import { as, newAdmin, newCustomer, newDispatcher, newDriver, newRolelessUser, newSupplier } from './actors';
import { FakeClock, HOUR, REFERENCE_TIME } from './clock';
import { createTestContext, type TestContext } from './database';
import {
  createDatabase,
  dropDatabase,
  dropOrphanedDatabases,
  dropStaleDatabases,
  listTestDatabases,
  parseStamp,
  stampOf,
  TEST_DB_PREFIX,
} from './db-admin';
import { createCard, createJobsite, createProduct, createStore, DANA_CARDS, seedAccounts } from './fixtures';
import { command, expectError, expectOk, get } from './http';
import { connectLive } from './live';
import { outboxEvents, sentMessages } from './outbox';
import { concurrently, hold, race } from './race';

const databaseExists = async (name: string) => (await listTestDatabases()).includes(name);

describe('FakeClock', () => {
  test('starts at Thu 2026-11-19 12:25 Toronto and moves only when told', () => {
    const clock = new FakeClock();
    assert.equal(clock.now(), REFERENCE_TIME);
    const toronto = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(clock.now());
    assert.match(toronto, /Thu.*2026-11-19.*12:25/);
    assert.equal(clock.advance(HOUR), REFERENCE_TIME + HOUR);
    clock.set(5);
    assert.equal(clock.now(), 5);
  });
});

describe('databases (§12.1)', () => {
  test('a context gets its own clone of the run template, with the categories and empty tables', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    try {
      assert.notEqual(a.databaseName, b.databaseName);
      assert.ok(a.databaseName.startsWith(TEST_DB_PREFIX));
      if (process.env.TEST_RUN) assert.ok(a.databaseName.startsWith(`${process.env.TEST_RUN}_`));
      const { rows } = await a.pool.query<{ categories: number; users: number; current: string }>(
        `SELECT (SELECT count(*)::int FROM categories) AS categories,
                (SELECT count(*)::int FROM users) AS users, current_database() AS current`,
      );
      assert.deepEqual(rows[0], { categories: 25, users: 0, current: a.databaseName });
      // Writes in one file's database are invisible to another's.
      await newCustomer(a);
      const other = await b.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
      assert.equal(other.rows[0]!.n, 0);
    } finally {
      await a.close();
      await b.close();
    }
    assert.equal(await databaseExists(a.databaseName), false);
    assert.equal(await databaseExists(b.databaseName), false);
  });

  test('close() is idempotent', async () => {
    const ctx = await createTestContext();
    await Promise.all([ctx.close(), ctx.close()]);
    await ctx.close();
    assert.equal(await databaseExists(ctx.databaseName), false);
  });

  test('stamps round-trip; left-overs older than 6 hours are swept, fresh ones are kept', async () => {
    assert.equal(stampOf(Date.UTC(2026, 10, 19, 17, 25)), '202611191725');
    assert.equal(parseStamp('instasupply_test_202611191725_abcdef_tpl'), Date.UTC(2026, 10, 19, 17, 25));
    assert.equal(parseStamp('instasupply_dev'), null);
    const old = `${TEST_DB_PREFIX}${stampOf(Date.now() - 7 * HOUR)}_c0ffee_sweep_${process.pid}`;
    const fresh = `${TEST_DB_PREFIX}${stampOf(Date.now() - 5 * HOUR)}_c0ffee_keep_${process.pid}`;
    await createDatabase(old);
    await createDatabase(fresh);
    try {
      const dropped = await dropStaleDatabases();
      assert.ok(dropped.includes(old));
      assert.ok(!dropped.includes(fresh));
      assert.equal(await databaseExists(old), false);
      assert.equal(await databaseExists(fresh), true);
    } finally {
      await dropDatabase(old);
      await dropDatabase(fresh);
    }
  });
});

describe('orphans', () => {
  test('a per-file database whose process is gone is dropped; a live process keeps its own', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    assert.ok(dead);
    const run = `${TEST_DB_PREFIX}${stampOf(Date.now())}_0dead0`;
    const orphan = `${run}_${dead}_1`;
    const mine = `${run}_${process.pid}_1`;
    await createDatabase(orphan);
    await createDatabase(mine);
    try {
      const dropped = await dropOrphanedDatabases();
      assert.ok(dropped.includes(orphan));
      assert.ok(!dropped.includes(mine));
      assert.equal(await databaseExists(mine), true);
    } finally {
      await dropDatabase(orphan);
      await dropDatabase(mine);
    }
  });
});

describe('fixtures, actors and HTTP helpers (§12.2)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('the named data set: every role signs in through POST /auth/login and GET /me knows it', async () => {
    await seedAccounts(ctx);
    const expected: [string, string, Partial<Record<string, unknown>>][] = [
      ['admin', 'admin', {}],
      ['dispatcher', 'dispatcher', {}],
      ['dana', 'customer', { phoneVerified: true, phoneNumber: '+14165550110' }],
      ['sam', 'customer', {}],
      ['kestrelOwner', 'supplier', { storeId: 'kestrel-lumber', storeRole: 'owner' }],
      ['kestrelStaff', 'supplier', { storeId: 'kestrel-lumber', storeRole: 'staff' }],
      ['bluestoneOwner', 'supplier', { storeId: 'bluestone-drywall', storeRole: 'owner' }],
      ['marco', 'driver', { cityId: 'toronto', status: 'active' }],
      ['gurpreet', 'driver', { cityId: 'brampton' }],
      ['lena', 'driver', { status: 'pending', cityId: 'mississauga' }],
    ];
    for (const [key, role, fields] of expected) {
      const actor = await as(ctx, key);
      const me = await expectOk(actor.get<MeResponse>('/me'));
      assert.equal(me.account.uid, actor.uid, key);
      assert.equal(me.profile?.role, role, key);
      for (const [field, value] of Object.entries(fields))
        assert.deepEqual((me.profile as unknown as Record<string, unknown>)[field], value, `${key}.${field}`);
      if (role === 'supplier') assert.equal(me.store?.id, fields.storeId);
    }
    // as() caches one session per name.
    assert.equal((await as(ctx, 'dana')).token, (await as(ctx, 'dana')).token);
  });

  test('seed rows: Dana has three jobsites and the six test cards; drivers have class and position', async () => {
    const dana = await as(ctx, 'dana');
    const cards = await ctx.pool.query<{ last4: string; is_default: boolean }>(
      'SELECT last4, is_default FROM cards WHERE user_id = $1 ORDER BY created_at, last4',
      [dana.uid],
    );
    assert.deepEqual(cards.rows.map((row) => row.last4).sort(), [...DANA_CARDS].sort());
    assert.deepEqual(
      cards.rows.filter((row) => row.is_default).map((row) => row.last4),
      ['4242'],
    );
    const jobsites = await ctx.pool.query<{ n: number; defaults: number }>(
      'SELECT count(*)::int AS n, count(*) FILTER (WHERE is_default)::int AS defaults FROM jobsites WHERE user_id = $1',
      [dana.uid],
    );
    assert.deepEqual(jobsites.rows[0], { n: 3, defaults: 1 });
    const drivers = await ctx.pool.query<{
      display_name: string;
      capacity_class: string;
      online: boolean | null;
    }>(
      `SELECT u.display_name, u.capacity_class, l.online FROM users u LEFT JOIN driver_locations l ON l.driver_id = u.id
        WHERE u.role = 'driver' ORDER BY u.display_name`,
    );
    assert.deepEqual(
      drivers.rows.map((row) => [row.display_name, row.capacity_class, row.online]),
      [
        ['Aisha Rahman', 'cargo_van', true],
        ['Devon Clarke', 'box_truck', true],
        ['Gurpreet Sandhu', 'flatbed', true],
        ['Lena Kowalski', 'suv', false],
        ['Marco Bellini', 'pickup', true],
        ['Tom Nguyen', 'car', true],
      ],
    );
    const products = await ctx.pool.query<{ listed: number; unlisted: number }>(
      `SELECT count(*) FILTER (WHERE listed)::int AS listed, count(*) FILTER (WHERE NOT listed)::int AS unlisted FROM products`,
    );
    assert.ok(products.rows[0]!.listed >= 10);
  });

  test('fresh actors of every role, with stores, products, jobsites and cards', async () => {
    const customer = await newCustomer(ctx);
    const supplier = await newSupplier(ctx, { store: { name: 'Fixture Yard' } });
    const staff = await newSupplier(ctx, { storeId: supplier.storeId, storeRole: 'staff' });
    const driver = await newDriver(ctx, { cityId: 'vaughan', capacityClass: 'flatbed' });
    const pending = await newDriver(ctx, { status: 'pending', capacityClass: 'car' });
    const dispatcher = await newDispatcher(ctx);
    const admin = await newAdmin(ctx);
    const roleless = await newRolelessUser(ctx);

    const meOf = async (actor: { get: typeof customer.get }) => expectOk(actor.get<MeResponse>('/me'));
    assert.equal((await meOf(customer)).profile?.role, 'customer');
    assert.equal((await meOf(supplier)).store?.name, 'Fixture Yard');
    assert.equal((await meOf(staff)).profile?.storeRole, 'staff');
    const driverMe = await meOf(driver);
    assert.equal(driverMe.profile?.cityId, 'vaughan');
    assert.equal(driverMe.profile?.vehicle?.capacityClass, 'flatbed');
    assert.equal((await meOf(pending)).profile?.status, 'pending');
    assert.equal((await meOf(dispatcher)).profile?.role, 'dispatcher');
    assert.equal((await meOf(admin)).profile?.role, 'admin');
    assert.equal((await meOf(roleless)).profile, null);

    const store = await createStore(ctx, { status: 'coming_soon' });
    const live = await createProduct(ctx, supplier.storeId, { priceCents: 1234, stockOnHand: 4 });
    const hidden = await createProduct(ctx, store.id);
    const { rows } = await ctx.pool.query<{ id: string; listed: boolean; price_cents: string }>(
      'SELECT id, listed, price_cents FROM products WHERE id = ANY($1) ORDER BY id',
      [[live.id, hidden.id]],
    );
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.listed])), {
      [live.id]: true,
      [hidden.id]: false,
    });
    const jobsite = await createJobsite(ctx, customer.uid, { isDefault: true, maxVehicleClass: 'cargo_van' });
    const card = await createCard(ctx, customer.uid, { last4: '0341' });
    assert.equal(jobsite.fields.maxVehicleClass, 'cargo_van');
    assert.equal(card.brand, 'visa');
  });

  test('expectError checks the envelope by HTTP status, API status and code', async () => {
    await expectError(get(ctx, '/me'), 401);
    await expectError(get(ctx, '/me'), 'unauthenticated');
    const dana = await as(ctx, 'dana');
    await expectError(command(ctx, 'noSuchCommand', {}, dana.token), 404);
    await expectError(dana.call('requestPhoneOtp', { phoneNumber: '+1 876 555 0123' }), 'invalid-argument');
    await assert.rejects(expectError(dana.get('/me'), 401), /expected an error envelope/);
    await assert.rejects(expectOk(get(ctx, '/me')), /expected 200, got 401/);
  });

  test('actor.refresh() rotates the pair and keeps the client usable', async () => {
    const actor = await newCustomer(ctx);
    const before = actor.session.refreshToken;
    await expectOk(actor.refresh());
    assert.notEqual(actor.session.refreshToken, before);
    await expectOk(actor.get('/me'));
  });
});

describe('outbox, live and jobs (§12.2)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('a command enqueues; drainOutbox runs it; the SMS lands in dev_outbox', async () => {
    const customer = await newCustomer(ctx);
    const sent = await expectOk(
      customer.call<{ devCode?: string }>('requestPhoneOtp', { phoneNumber: '416 555 0123' }),
    );
    const pending = await outboxEvents(ctx, 'sms.send', 'pending');
    assert.equal(pending.length, 1);
    assert.equal(await ctx.drainOutbox(), 1);
    assert.equal((await outboxEvents(ctx, 'sms.send', 'done')).length, 1);
    const messages = await sentMessages(ctx, 'sms');
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, '+14165550123');
    assert.equal(messages[0]!.purpose, 'otp');
    assert.ok(sent.devCode && messages[0]!.body?.includes(sent.devCode));
    assert.equal(await ctx.drainOutbox(), 0);
  });

  test('connectLive: auth, subscribe, an event after a command commits, close codes', async () => {
    const customer = await newCustomer(ctx);
    const live = await customer.live();
    const subscribed = await live.subscribe([`user:${customer.uid}`, 'user:someone-else']);
    assert.deepEqual(subscribed.topics, [`user:${customer.uid}`]);
    assert.equal(subscribed.denied.length, 1);
    const sent = await expectOk(
      customer.call<{ devCode: string }>('requestPhoneOtp', { phoneNumber: '647 555 0177' }),
    );
    await expectOk(customer.call('verifyPhoneOtp', { code: sent.devCode }));
    const event = await live.nextEvent(`user:${customer.uid}`, { kind: 'updated' });
    assert.equal(event.id, customer.uid);
    live.close();
    assert.equal(typeof (await live.closed()), 'number');

    const anonymous = await connectLive(ctx);
    anonymous.send({ type: 'ping' });
    await anonymous.next('pong');
    const denied = await anonymous.subscribe([`user:${customer.uid}`, 'stores']);
    assert.deepEqual(denied.topics, ['stores']);
    anonymous.close();
  });

  test('runJob runs a registered job at the fake clock', async () => {
    const result = await ctx.runJob('purgeExpiredRows');
    assert.equal(typeof result, 'object');
    await assert.rejects(ctx.runJob('noSuchJob'), /no job called noSuchJob/);
  });

  test('the doubles: payments are recorded, push never leaves the process', async () => {
    assert.equal(ctx.deps.gateway, ctx.gateway);
    assert.equal(ctx.deps.push, ctx.push);
    const card = { cardId: 'c', brand: 'visa' as const };
    const declined = await ctx.deps.gateway.authorize({
      idempotencyKey: 'auth_o1',
      amountCents: 100,
      customerId: 'u',
      card: { ...card, last4: '0002' },
    });
    const ok = await ctx.deps.gateway.authorize({
      idempotencyKey: 'auth_o2',
      amountCents: 100,
      customerId: 'u',
      card: { ...card, last4: '4242' },
    });
    assert.deepEqual(declined, { ok: false, reason: 'card_declined' });
    assert.ok(ok.ok);
    await ctx.deps.gateway.void({ idempotencyKey: 'void_o2', intentRef: 'test_pi_o2' });
    assert.deepEqual(ctx.gateway.intents(), ['test_pi_o2']);
    assert.equal(ctx.gateway.of('void').length, 1);
    ctx.push.unregistered.add('ExponentPushToken[gone]');
    const tickets = await ctx.deps.push.send([
      {
        to: 'ExponentPushToken[ok]',
        title: 't',
        body: 'b',
        sound: 'default',
        priority: 'high',
        channelId: 'x',
        data: {},
      },
      {
        to: 'ExponentPushToken[gone]',
        title: 't',
        body: 'b',
        sound: 'default',
        priority: 'high',
        channelId: 'x',
        data: {},
      },
    ]);
    assert.equal(tickets[0]!.status, 'ok');
    assert.equal(tickets[1]!.status, 'error');
    assert.equal(ctx.push.sent.length, 2);
  });
});

describe('concurrency helpers (§12.3)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('concurrently runs N requests at once on separate connections', async () => {
    const customer = await newCustomer(ctx);
    const answers = await concurrently(12, () => customer.get('/me'));
    assert.deepEqual(new Set(answers.map((answer) => answer.status)), new Set([200]));
    // Requests overlap: a pg_sleep in each of 4 parallel queries ends well before 4 × the sleep.
    const started = Date.now();
    await concurrently(4, () => ctx.pool.query('SELECT pg_sleep(0.3)'));
    assert.ok(Date.now() - started < 1100, 'the queries ran one after another');
  });

  test('hold stops a request at a named point until released', async () => {
    const customer = await newCustomer(ctx);
    const gate = hold(ctx, 'refresh:afterRotate');
    let finished = false;
    const pending = customer.refresh().then((answer) => {
      finished = true;
      return answer;
    });
    await gate.reached();
    assert.ok(gate.isReached());
    // While A waits at the point, another request runs to completion.
    await expectOk(customer.get('/me'));
    assert.equal(finished, false);
    gate.release();
    await expectOk(pending);
    assert.ok(ctx.hooks.visited.includes('refresh:afterRotate'));
  });

  test('a hold nobody reaches fails the test instead of hanging it', async () => {
    const gate = hold(ctx, 'never:reached');
    await assert.rejects(gate.reached(50), /no request reached never:reached within 50 ms/);
    gate.release();
  });

  test('race repeats the run on fresh data and names the failing round', async () => {
    let rounds = 0;
    await race({
      times: 3,
      setup: () => newCustomer(ctx),
      run: (actor) => [() => actor.get('/me'), () => actor.get('/me')],
      check: (answers) => {
        rounds += 1;
        assert.deepEqual(
          answers.map((answer) => answer.status),
          [200, 200],
        );
      },
    });
    assert.equal(rounds, 3);
    await assert.rejects(
      race({
        times: 2,
        setup: async () => null,
        run: () => [async () => 1],
        check: (_results, _state, round) => assert.notEqual(round, 1),
      }),
      /race round 2\/2/,
    );
  });
});
