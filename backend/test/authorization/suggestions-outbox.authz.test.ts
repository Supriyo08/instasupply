/**
 * Store suggestions, the dev outbox and ops (MARKETPLACE §6.2, §13.2 → PLATFORM §7.3, §5.3.8, §5.3.10):
 * suggestions are created only through `suggestStore` (public; there is no REST create) and staff read them
 * and set `status` only; the dev outbox is staff-only and its sensitive rows (codes, links) are for admins
 * only; `/ops/*` is staff-only, the transactional outbox admin-only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  JobState,
  OpsDashboard,
  OpsStoreRow,
  OutboxEvent,
  Page,
  StoreSuggestion,
  WithId,
} from '@instasupply/shared';
import { withTransaction } from '../../src/platform/db/tx';
import { recordOutboxMessage } from '../../src/platform/dev-outbox';
import { enqueue } from '../../src/platform/outbox/outbox';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { command, expectError, expectOk, get, post, request } from '../support/http';

interface OutboxMessage {
  id: string;
  channel: 'sms' | 'email';
  to: string;
  body: string | null;
  purpose: string;
}

describe('store suggestions, dev outbox and ops', () => {
  let ctx: TestContext;
  let customer: ActorClient;
  let supplier: ActorClient;
  let driver: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;
  before(async () => {
    ctx = await createTestContext();
    customer = await newCustomer(ctx);
    supplier = await newSupplier(ctx);
    driver = await newDriver(ctx);
    dispatcher = await newDispatcher(ctx);
    admin = await newAdmin(ctx);
  });
  after(() => ctx.close());

  const body = { storeName: 'Danforth Hardware', city: 'Toronto', interests: [], email: null };

  test('anyone suggests a store through suggestStore; the source follows X-Client', async () => {
    await expectOk(command(ctx, 'suggestStore', body));
    await expectOk(customer.call('suggestStore', { ...body, email: 'Dana@Example.com' }));
    await expectOk(
      post(ctx, '/call/suggestStore', body, { headers: { 'x-client': 'customer/1.4.0 (android)' } }),
    );
    const { rows } = await ctx.pool.query<{
      source: string;
      suggested_by: string | null;
      email: string | null;
    }>(`SELECT source, suggested_by, email FROM store_suggestions ORDER BY created_at, id`);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.source).sort(), ['app', 'web', 'web']);
    assert.ok(rows.some((r) => r.suggested_by === customer.uid && r.email === 'dana@example.com'));
    const staffNote = await ctx.pool.query<{ push_status: string }>(
      `SELECT push_status FROM notifications WHERE type = 'store_suggestion'`,
    );
    assert.ok(
      staffNote.rows.length > 0 && staffNote.rows.every((r) => r.push_status === 'skipped'),
      'silent',
    );
  });

  test('suggestStore validates its input strictly', async () => {
    await expectError(command(ctx, 'suggestStore', { ...body, status: 'onboarding' }), 'invalid-argument');
    await expectError(command(ctx, 'suggestStore', { ...body, storeName: 'x' }), 'invalid-argument');
    await expectError(
      command(ctx, 'suggestStore', { ...body, interests: ['Not a chip'] }),
      'invalid-argument',
    );
    await expectError(command(ctx, 'suggestStore', { ...body, email: 'not-an-email' }), 'invalid-argument');
  });

  test('there is no REST create; only staff read suggestions and set status, and only status', async () => {
    assert.equal((await customer.post('/store-suggestions', body)).status, 404);
    for (const actor of [customer, supplier, driver]) {
      await expectError(actor.get('/store-suggestions'), 'permission-denied');
    }
    await expectError(get(ctx, '/store-suggestions'), 'unauthenticated');
    const list = await expectOk(dispatcher.get<Page<WithId<StoreSuggestion>>>('/store-suggestions'));
    const id = list.items[0]!.id;
    await expectError(
      customer.patch(`/store-suggestions/${id}`, { status: 'contacted' }),
      'permission-denied',
    );
    const patched = await expectOk(
      dispatcher.patch<WithId<StoreSuggestion>>(`/store-suggestions/${id}`, { status: 'contacted' }),
    );
    assert.equal(patched.status, 'contacted');
    await expectError(
      dispatcher.patch(`/store-suggestions/${id}`, { status: 'contacted', storeName: 'Renamed' }),
      'invalid-argument',
    );
    await expectError(
      dispatcher.patch(`/store-suggestions/${id}`, { status: 'approved' }),
      'invalid-argument',
    );
    const filtered = await expectOk(
      admin.get<Page<WithId<StoreSuggestion>>>('/store-suggestions?status=contacted'),
    );
    assert.deepEqual(
      filtered.items.map((s) => s.id),
      [id],
    );
  });

  test('the dev outbox is staff-only; sensitive rows only for admins', async () => {
    const base = {
      channel: 'sms' as const,
      to: '+14165550110',
      subject: null,
      provider: 'outbox' as const,
      status: 'stored' as const,
      providerRef: null,
      error: null,
      now: ctx.clock.now(),
    };
    await recordOutboxMessage(ctx.pool, {
      ...base,
      body: 'Your code is 123456',
      purpose: 'otp',
      sensitive: true,
    });
    await recordOutboxMessage(ctx.pool, {
      ...base,
      body: 'New order IS-10001-A',
      purpose: 'store_alert',
      sensitive: false,
    });
    for (const actor of [customer, supplier, driver]) {
      await expectError(actor.get('/dev-outbox'), 'permission-denied');
    }
    await expectError(get(ctx, '/dev-outbox'), 'unauthenticated');
    const forDispatcher = await expectOk(dispatcher.get<Page<OutboxMessage>>('/dev-outbox'));
    assert.deepEqual(
      forDispatcher.items.map((m) => m.purpose),
      ['store_alert'],
    );
    const forAdmin = await expectOk(admin.get<Page<OutboxMessage>>('/dev-outbox?channel=sms'));
    assert.deepEqual(forAdmin.items.map((m) => m.purpose).sort(), ['otp', 'store_alert']);
    assert.equal(
      (await expectOk(admin.get<Page<OutboxMessage>>('/dev-outbox?channel=email'))).items.length,
      0,
    );
  });

  test('/ops/* is staff-only', async () => {
    for (const path of ['/ops/dashboard', '/ops/stores', '/ops/jobs']) {
      for (const actor of [customer, supplier, driver])
        await expectError(actor.get(path), 'permission-denied');
      await expectError(get(ctx, path), 'unauthenticated');
    }
    const dashboard = await expectOk(dispatcher.get<OpsDashboard>('/ops/dashboard'));
    assert.equal(dashboard.generatedAt, ctx.clock.now());
    assert.equal(dashboard.liveStores, 1);
    const stores = await expectOk(dispatcher.get<Page<OpsStoreRow>>('/ops/stores'));
    assert.equal(stores.items.length, 1);
    assert.equal(stores.items[0]!.openNow, true, 'Thu 12:25 is inside the fixture hours');
    const jobs = await expectOk(admin.get<Page<JobState>>('/ops/jobs'));
    assert.ok(
      jobs.items.some((j) => j.job === 'runDailyPayouts' && j.schedule === 'daily 21:00 America/Toronto'),
    );
  });

  test('the transactional outbox and its retry are admin-only; retry needs a dead event', async () => {
    await withTransaction(ctx.deps, (tx) =>
      enqueue(tx, 'mail.send', { to: 'x@example.com', subject: 'code', text: '123456' }, { sensitive: true }),
    );
    const { rows } = await ctx.pool.query<{ id: number }>(
      `SELECT id::int AS id FROM outbox WHERE event = 'mail.send' ORDER BY id DESC LIMIT 1`,
    );
    const id = rows[0]!.id;
    for (const actor of [dispatcher, customer, supplier, driver]) {
      await expectError(actor.get('/ops/outbox-events'), 'permission-denied');
      await expectError(actor.post(`/ops/outbox-events/${id}/retry`), 'permission-denied');
    }
    const events = await expectOk(admin.get<Page<OutboxEvent>>('/ops/outbox-events?status=pending'));
    const event = events.items.find((e) => e.id === id);
    assert.ok(event);
    assert.equal(event.payload, null, 'a sensitive payload is never shown');
    await expectError(admin.post(`/ops/outbox-events/${id}/retry`), 'failed-precondition');

    await ctx.pool.query(`UPDATE outbox SET status = 'dead', attempts = 5, finished_at = $2 WHERE id = $1`, [
      id,
      new Date(ctx.clock.now()),
    ]);
    await expectOk(admin.post(`/ops/outbox-events/${id}/retry`), 204);
    const retried = await ctx.pool.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM outbox WHERE id = $1`,
      [id],
    );
    assert.deepEqual(retried.rows[0], { status: 'pending', attempts: 0 });
    await expectError(admin.post('/ops/outbox-events/999999/retry'), 'not-found');
    assert.equal((await request(ctx, 'POST', `/ops/outbox-events/${id}/retry`, {})).status, 401);
  });
});
