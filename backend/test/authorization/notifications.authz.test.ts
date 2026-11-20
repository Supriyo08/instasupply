/**
 * The inbox (MARKETPLACE §6.2, §13.2 → PLATFORM §7.3, §5.3.3): the recipient reads, marks read and deletes;
 * nobody else, staff included; nothing but `read` can change (there is no PATCH and the read endpoints take no
 * body). Every role has an inbox.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { AppNotification, Page } from '@instasupply/shared';
import { notify } from '../../src/modules/notifications';
import { withTransaction } from '../../src/platform/db/tx';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { expectError, expectOk, get, post, request } from '../support/http';

describe('notifications', () => {
  let ctx: TestContext;
  let customerA: ActorClient;
  let customerB: ActorClient;
  let supplier: ActorClient;
  let driver: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;

  const give = async (uid: string, key: string, title = key) => {
    await withTransaction(ctx.deps, (tx) => notify(tx, uid, { type: 'system', title, body: 'body', key }));
    const { rows } = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM notifications WHERE user_id = $1 AND dedupe_key = $2`,
      [uid, key],
    );
    return rows[0]!.id;
  };

  before(async () => {
    ctx = await createTestContext();
    customerA = await newCustomer(ctx);
    customerB = await newCustomer(ctx);
    supplier = await newSupplier(ctx);
    driver = await newDriver(ctx);
    dispatcher = await newDispatcher(ctx);
    admin = await newAdmin(ctx);
  });
  after(() => ctx.close());

  test('anonymous callers are unauthenticated', async () => {
    const id = await give(customerA.uid, 'anon');
    await expectError(get(ctx, '/notifications'), 'unauthenticated');
    await expectError(get(ctx, '/notifications/unread-count'), 'unauthenticated');
    await expectError(post(ctx, `/notifications/${id}/read`, {}), 'unauthenticated');
    await expectError(post(ctx, '/notifications/read-all', {}), 'unauthenticated');
    await expectError(request(ctx, 'DELETE', `/notifications/${id}`), 'unauthenticated');
  });

  test('every role reads only its own inbox, newest first', async () => {
    for (const actor of [customerA, supplier, driver, dispatcher, admin]) {
      ctx.clock.advance(1000);
      await give(actor.uid, `own-${actor.uid}`, `for ${actor.uid}`);
      const page = await expectOk(actor.get<Page<AppNotification>>('/notifications'));
      assert.ok(page.items.length > 0);
      assert.ok(page.items.every((n) => n.userId === actor.uid));
    }
    const a1 = await give(customerA.uid, 'a-older');
    ctx.clock.advance(1000);
    const a2 = await give(customerA.uid, 'a-newer');
    const page = await expectOk(customerA.get<Page<AppNotification>>('/notifications?limit=2'));
    assert.deepEqual(
      page.items.map((n) => n.id),
      [a2, a1],
    );
    const b = await expectOk(customerB.get<Page<AppNotification>>('/notifications'));
    assert.equal(b.items.length, 0);
  });

  test('the recipient marks read; nobody else can, not even staff', async () => {
    const id = await give(customerA.uid, 'mark');
    for (const other of [customerB, supplier, driver, dispatcher, admin]) {
      await expectError(other.post(`/notifications/${id}/read`), 'permission-denied');
    }
    const before = await expectOk(customerA.get<{ count: number }>('/notifications/unread-count'));
    await expectOk(customerA.post(`/notifications/${id}/read`), 204);
    await expectOk(customerA.post(`/notifications/${id}/read`), 204);
    const after = await expectOk(customerA.get<{ count: number }>('/notifications/unread-count'));
    assert.equal(after.count, before.count - 1);
    const unread = await expectOk(
      customerA.get<Page<AppNotification>>('/notifications?unread=true&limit=500'),
    );
    assert.ok(!unread.items.some((n) => n.id === id));
    const all = await expectOk(customerA.get<Page<AppNotification>>('/notifications?limit=500'));
    const read = all.items.find((n) => n.id === id);
    assert.equal(read?.read, true);
    assert.equal(read?.readAt, ctx.clock.now());
  });

  test('nothing else can change: no PATCH or PUT, and an unknown notification is not-found', async () => {
    const id = await give(customerA.uid, 'immutable');
    assert.equal((await customerA.patch(`/notifications/${id}`, { title: 'changed' })).status, 404);
    assert.equal((await customerA.put(`/notifications/${id}`, { read: false })).status, 404);
    await expectError(
      customerA.post('/notifications/00000000-0000-4000-8000-000000000000/read'),
      'not-found',
    );
    const { rows } = await ctx.pool.query<{ title: string }>(
      `SELECT title FROM notifications WHERE id = $1`,
      [id],
    );
    assert.equal(rows[0]!.title, 'immutable');
  });

  test('read-all marks only the caller’s notifications', async () => {
    const mine = await give(customerA.uid, 'all-a');
    const theirs = await give(customerB.uid, 'all-b');
    await expectOk(customerA.post('/notifications/read-all'), 204);
    assert.equal((await expectOk(customerA.get<{ count: number }>('/notifications/unread-count'))).count, 0);
    assert.equal((await expectOk(customerB.get<{ count: number }>('/notifications/unread-count'))).count, 1);
    const { rows } = await ctx.pool.query<{ id: string; read: boolean }>(
      `SELECT id, read FROM notifications WHERE id = ANY($1::text[]) ORDER BY id`,
      [[mine, theirs]],
    );
    assert.deepEqual(
      new Map(rows.map((r) => [r.id, r.read])),
      new Map([
        [mine, true],
        [theirs, false],
      ]),
    );
  });

  test('the recipient deletes; nobody else can', async () => {
    const id = await give(customerB.uid, 'delete');
    for (const other of [customerA, dispatcher, admin]) {
      await expectError(other.del(`/notifications/${id}`), 'permission-denied');
    }
    await expectOk(customerB.del(`/notifications/${id}`), 204);
    await expectError(customerB.del(`/notifications/${id}`), 'not-found');
  });
});
