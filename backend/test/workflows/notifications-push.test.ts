/**
 * Notifications and Expo push (docs/PLATFORM.md §10.2, §12.4, owner `money-comms`): the rows of the key table
 * that money-comms produces (support, chat, store suggestion, payout sent / skipped / failed, the test
 * notification), each once with its key; a keyed notify is idempotent; silent rows are inbox-only; the
 * `push.send` handler applies preferences and channels, groups messages by app (one Expo project per request),
 * stores tickets, and removes a device on `DeviceNotRegistered` (ticket and receipt); `checkPushReceipts`.
 *
 * Devices are written straight into `devices` (the `PUT /me/devices` endpoint is tested in
 * device-tokens.test.ts); PUSH_ENABLED is on so the handler really sends (to the recording client).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { SendTestNotificationResponse } from '@instasupply/shared';
import { notify, notifyStaff, notifyStoreMembers } from '../../src/modules/notifications';
import { runKeyOf } from '../../src/modules/payouts';
import { withTransaction } from '../../src/platform/db/tx';
import type { ExpoMessage, ExpoTicket } from '../../src/platform/push/expo';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { RecordingPush } from '../support/doubles';
import { command, expectOk } from '../support/http';
import { outboxEvents } from '../support/outbox';

/** Records each Expo request separately, so a test can see how messages were grouped. */
class BatchingPush extends RecordingPush {
  readonly batches: ExpoMessage[][] = [];
  override async send(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    this.batches.push([...messages]);
    return super.send(messages);
  }
}

interface Row {
  id: string;
  user_id: string;
  type: string;
  dedupe_key: string | null;
  push_status: string;
  push_success: number;
  push_failure: number;
}

describe('notifications and push', () => {
  let ctx: TestContext;
  let push: BatchingPush;
  let customer: ActorClient;
  let driver: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;
  let owner: ActorClient & { storeId: string };
  let storeStaff: ActorClient;

  const rows = async (filter: { key?: string; userId?: string; type?: string } = {}): Promise<Row[]> => {
    const { rows: found } = await ctx.pool.query<Row>(
      `SELECT id, user_id, type, dedupe_key, push_status, push_success, push_failure FROM notifications
        WHERE ($1::text IS NULL OR dedupe_key = $1) AND ($2::text IS NULL OR user_id = $2)
          AND ($3::text IS NULL OR type = $3)
        ORDER BY created_at, id`,
      [filter.key ?? null, filter.userId ?? null, filter.type ?? null],
    );
    return found;
  };

  const addDevice = async (
    uid: string,
    app: 'customer' | 'driver' | 'console',
    token = `ExponentPushToken[${randomUUID()}]`,
  ) => {
    await ctx.pool.query(
      `INSERT INTO devices (user_id, installation_id, token, provider, platform, app, app_version, device_name,
                            created_at, last_seen_at)
       VALUES ($1, $2, $3, 'expo', 'android', $4, '1.0.0', 'Test phone', $5, $5)`,
      [uid, `install-${randomUUID()}`, token, app, new Date(ctx.clock.now())],
    );
    return token;
  };

  const devicesOf = async (uid: string): Promise<string[]> => {
    const { rows: found } = await ctx.pool.query<{ token: string }>(
      `SELECT token FROM devices WHERE user_id = $1 ORDER BY token`,
      [uid],
    );
    return found.map((r) => r.token);
  };

  const setPreferences = (uid: string, preferences: Record<string, boolean>) =>
    ctx.pool.query(`UPDATE users SET doc = jsonb_set(doc, '{preferences}', $2::jsonb) WHERE id = $1`, [
      uid,
      JSON.stringify(preferences),
    ]);

  const inTx = (fn: Parameters<typeof withTransaction>[1]) => withTransaction(ctx.deps, fn);

  before(async () => {
    push = new BatchingPush();
    ctx = await createTestContext({ env: { PUSH_ENABLED: 'true' }, deps: { push } });
    customer = await newCustomer(ctx, { displayName: 'Dana Whitfield' });
    driver = await newDriver(ctx, { displayName: 'Marco Rossi' });
    dispatcher = await newDispatcher(ctx);
    admin = await newAdmin(ctx);
    owner = await newSupplier(ctx, { store: { id: 'kestrel-lumber', name: 'Kestrel Lumber Yard' } });
    storeStaff = await newSupplier(ctx, { storeId: owner.storeId, storeRole: 'staff' });
  });
  after(() => ctx.close());

  test('a keyed notify is produced once; an unkeyed one each time; silent rows are inbox-only', async () => {
    const input = { type: 'system' as const, title: 'Hello', body: 'World', key: 'once-1' };
    await inTx((tx) => notify(tx, customer.uid, input));
    await inTx((tx) => notify(tx, customer.uid, input));
    assert.equal((await rows({ key: 'once-1' })).length, 1);
    const [row] = await rows({ key: 'once-1' });
    assert.equal(
      (await outboxEvents(ctx, 'push.send')).filter((e) => e.dedupeKey === `push:${row!.id}`).length,
      1,
    );

    await inTx((tx) => notify(tx, customer.uid, { type: 'system', title: 'a', body: 'b' }));
    await inTx((tx) => notify(tx, customer.uid, { type: 'system', title: 'a', body: 'b' }));
    assert.equal((await rows({ userId: customer.uid })).filter((r) => r.dedupe_key === null).length, 2);

    await inTx((tx) =>
      notify(tx, customer.uid, { type: 'system', title: 'quiet', body: 'b', silent: true, key: 'silent-1' }),
    );
    const [silent] = await rows({ key: 'silent-1' });
    assert.equal(silent!.push_status, 'skipped');
    assert.equal(
      (await outboxEvents(ctx, 'push.send')).filter((e) => e.dedupeKey === `push:${silent!.id}`).length,
      0,
    );
    await ctx.drainOutbox();
  });

  test('titles are cut to 120 and bodies to 500 characters', async () => {
    await inTx((tx) =>
      notify(tx, customer.uid, {
        type: 'system',
        title: 'T'.repeat(300),
        body: 'B'.repeat(900),
        key: 'long',
      }),
    );
    const { rows: found } = await ctx.pool.query<{ title: string; body: string }>(
      `SELECT title, body FROM notifications WHERE dedupe_key = 'long'`,
    );
    assert.equal(found[0]!.title.length, 120);
    assert.equal(found[0]!.body.length, 500);
  });

  test('push.send: no devices → no_devices; a device → sent with channel, data and a stored ticket', async () => {
    await inTx((tx) =>
      notify(tx, driver.uid, {
        type: 'job_offer',
        title: 'New job',
        body: '$47.75',
        key: 'job-1',
        data: { deliveryId: 'd1' },
      }),
    );
    await ctx.drainOutbox();
    assert.equal((await rows({ key: 'job-1' }))[0]!.push_status, 'no_devices');

    const token = await addDevice(driver.uid, 'driver');
    await inTx((tx) =>
      notify(tx, driver.uid, {
        type: 'job_offer',
        title: 'New job',
        body: '$47.75',
        key: 'job-2',
        data: { deliveryId: 'd2' },
      }),
    );
    push.sent.length = 0;
    await ctx.drainOutbox();
    const [row] = await rows({ key: 'job-2' });
    assert.equal(row!.push_status, 'sent');
    assert.equal(row!.push_success, 1);
    assert.equal(push.sent.length, 1);
    const message = push.sent[0]!;
    assert.equal(message.to, token);
    assert.equal(message.channelId, 'jobs');
    assert.equal(message.sound, 'default');
    assert.equal(message.priority, 'high');
    assert.deepEqual(message.data, {
      deliveryId: 'd2',
      notificationId: row!.id,
      type: 'job_offer',
      userId: driver.uid,
    });
    const tickets = await ctx.pool.query<{ notification_id: string; check_after: number }>(
      `SELECT notification_id, check_after FROM push_tickets WHERE notification_id = $1`,
      [row!.id],
    );
    assert.equal(tickets.rows.length, 1);
    assert.equal(tickets.rows[0]!.check_after, ctx.clock.now() + 15 * MINUTE);
    // A second run of the same event changes nothing (the handler acts only while pending).
    const before = push.sent.length;
    await ctx.pool.query(
      `INSERT INTO outbox (event, payload, max_attempts, run_at, created_at) VALUES ('push.send', $1::jsonb, 5, $2, $2)`,
      [JSON.stringify({ notificationId: row!.id }), new Date(ctx.clock.now())],
    );
    await ctx.drainOutbox();
    assert.equal(push.sent.length, before);
  });

  test('preferences: chatPush off skips chat pushes; a driver cannot mute delivery_*; staff can', async () => {
    await addDevice(customer.uid, 'customer');
    await setPreferences(customer.uid, { chatPush: false, orderPush: true });
    await inTx(async (tx) => {
      await notify(tx, customer.uid, {
        type: 'support_reply',
        title: 'Support',
        body: 'hi',
        key: 'pref-chat',
      });
      await notify(tx, customer.uid, { type: 'order_update', title: 'Order', body: 'hi', key: 'pref-order' });
    });
    await setPreferences(driver.uid, { deliveryPush: false, jobPush: true });
    await inTx((tx) =>
      notify(tx, driver.uid, { type: 'delivery_assigned', title: 'Assigned', body: 'x', key: 'pref-drv' }),
    );
    await addDevice(dispatcher.uid, 'console');
    await setPreferences(dispatcher.uid, { deliveryPush: false });
    await inTx((tx) =>
      notify(tx, dispatcher.uid, { type: 'delivery_failed', title: 'Failed', body: 'x', key: 'pref-staff' }),
    );
    await ctx.drainOutbox();
    assert.equal((await rows({ key: 'pref-chat' }))[0]!.push_status, 'skipped');
    assert.equal((await rows({ key: 'pref-order' }))[0]!.push_status, 'sent');
    assert.equal((await rows({ key: 'pref-drv' }))[0]!.push_status, 'sent', 'drivers always get assignments');
    assert.equal((await rows({ key: 'pref-staff' }))[0]!.push_status, 'skipped');
    await setPreferences(customer.uid, {});
  });

  test('messages are grouped by app: one Expo request never mixes projects', async () => {
    const uid = (await newCustomer(ctx)).uid;
    await addDevice(uid, 'customer');
    await addDevice(uid, 'driver');
    await addDevice(uid, 'customer');
    await inTx((tx) => notify(tx, uid, { type: 'system', title: 'Both apps', body: 'x', key: 'grouped' }));
    push.batches.length = 0;
    await ctx.drainOutbox();
    assert.equal(push.batches.length, 2);
    assert.deepEqual(push.batches.map((b) => b.length).sort(), [1, 2]);
    assert.equal((await rows({ key: 'grouped' }))[0]!.push_success, 3);
  });

  test('DeviceNotRegistered: on a ticket the device goes at once; on a receipt checkPushReceipts removes it', async () => {
    const uid = (await newCustomer(ctx)).uid;
    const dead = await addDevice(uid, 'customer');
    const alive = await addDevice(uid, 'customer');
    push.unregistered.add(dead);
    await inTx((tx) => notify(tx, uid, { type: 'system', title: 'x', body: 'y', key: 'dnr' }));
    await ctx.drainOutbox();
    const [row] = await rows({ key: 'dnr' });
    assert.equal(row!.push_status, 'partial');
    assert.deepEqual(await devicesOf(uid), [alive]);

    const { rows: tickets } = await ctx.pool.query<{ ticket_id: string }>(
      `SELECT ticket_id FROM push_tickets WHERE notification_id = $1`,
      [row!.id],
    );
    assert.equal(tickets.length, 1);
    push.receipts.set(tickets[0]!.ticket_id, { status: 'error', details: { error: 'DeviceNotRegistered' } });
    const early = await ctx.runJob('checkPushReceipts', ctx.clock.now() + 5 * MINUTE);
    assert.equal(early.checked, 0, 'not before check_after');
    const result = await ctx.runJob('checkPushReceipts', ctx.clock.now() + 16 * MINUTE);
    assert.ok((result.checked ?? 0) >= 1);
    assert.ok((result.removedDevices ?? 0) >= 1);
    assert.deepEqual(await devicesOf(uid), []);
    const left = await ctx.pool.query(`SELECT 1 FROM push_tickets WHERE ticket_id = $1`, [
      tickets[0]!.ticket_id,
    ]);
    assert.equal(left.rows.length, 0, 'processed tickets are deleted');
  });

  test('sendTestNotification: a test notification for the caller and the number of devices', async () => {
    const answer = await expectOk(
      command<SendTestNotificationResponse>(ctx, 'sendTestNotification', {}, driver.token),
    );
    assert.equal(answer.devices, (await devicesOf(driver.uid)).length);
    const tests = await rows({ userId: driver.uid, type: 'test' });
    assert.equal(tests.length, 1);
    await ctx.drainOutbox();
    assert.equal((await rows({ userId: driver.uid, type: 'test' }))[0]!.push_status, 'sent');
  });

  test('support rows of §10.2: support_message to staff, support_reply to the customer and every store member', async () => {
    const inbound = randomUUID();
    await expectOk(
      customer.post(`/support-threads/${customer.uid}/messages`, {
        id: inbound,
        text: 'Help',
        context: null,
      }),
    );
    const reply = randomUUID();
    await expectOk(
      dispatcher.post(`/support-threads/${customer.uid}/messages`, {
        id: reply,
        text: 'Sure',
        context: null,
      }),
    );
    const storeReply = randomUUID();
    await expectOk(
      admin.post(`/support-threads/store_${owner.storeId}/messages`, {
        id: storeReply,
        text: 'Hi',
        context: null,
      }),
    );
    assert.deepEqual(
      (await rows({ key: `support-${inbound}` })).map((r) => [r.user_id, r.type]).sort(),
      [
        [admin.uid, 'support_message'],
        [dispatcher.uid, 'support_message'],
      ].sort(),
    );
    assert.deepEqual(
      (await rows({ key: `support-${reply}` })).map((r) => [r.user_id, r.type]),
      [[customer.uid, 'support_reply']],
    );
    assert.deepEqual(
      (await rows({ key: `support-${storeReply}` })).map((r) => r.user_id).sort(),
      [owner.uid, storeStaff.uid].sort(),
    );
    // A retried message notifies nobody again.
    await expectOk(
      dispatcher.post(`/support-threads/${customer.uid}/messages`, {
        id: reply,
        text: 'Sure',
        context: null,
      }),
    );
    assert.equal((await rows({ key: `support-${reply}` })).length, 1);
    push.sent.length = 0;
    await ctx.drainOutbox();
    const toCustomer = push.sent.find((m) => m.data.type === 'support_reply');
    assert.equal(toCustomer?.channelId, 'chat');
    assert.equal(toCustomer?.data.threadId, customer.uid);
  });

  test('chat rows of §10.2: driver → staff, dispatch → driver, key chat-{messageId}', async () => {
    const fromDriver = randomUUID();
    await expectOk(
      driver.post(`/threads/${driver.uid}/messages`, {
        id: fromDriver,
        text: 'Loaded',
        deliveryId: 'dl-1',
        kind: 'text',
      }),
    );
    const fromStaff = randomUUID();
    await expectOk(
      dispatcher.post(`/threads/${driver.uid}/messages`, {
        id: fromStaff,
        text: 'Thanks',
        deliveryId: null,
        kind: 'quick_reply',
      }),
    );
    const staffRows = await rows({ key: `chat-${fromDriver}` });
    assert.deepEqual(staffRows.map((r) => r.user_id).sort(), [admin.uid, dispatcher.uid].sort());
    assert.ok(staffRows.every((r) => r.type === 'chat_message'));
    assert.deepEqual(
      (await rows({ key: `chat-${fromStaff}` })).map((r) => r.user_id),
      [driver.uid],
    );
    const { rows: data } = await ctx.pool.query<{ data: Record<string, string>; title: string }>(
      `SELECT data, title FROM notifications WHERE dedupe_key = $1 LIMIT 1`,
      [`chat-${fromDriver}`],
    );
    assert.deepEqual(data[0]!.data, { threadId: driver.uid, deliveryId: 'dl-1' });
    assert.equal(data[0]!.title, 'Marco Rossi');
  });

  test('store suggestion: a silent staff row, key suggestion-{id}', async () => {
    await expectOk(
      command(ctx, 'suggestStore', {
        storeName: 'Danforth Hardware',
        city: 'Toronto',
        interests: [],
        email: null,
      }),
    );
    const { rows: found } = await ctx.pool.query<{ id: string }>(`SELECT id FROM store_suggestions`);
    const notes = await rows({ key: `suggestion-${found[0]!.id}` });
    assert.deepEqual(notes.map((r) => r.user_id).sort(), [admin.uid, dispatcher.uid].sort());
    assert.ok(notes.every((r) => r.type === 'store_suggestion' && r.push_status === 'skipped'));
  });

  test('payout rows of §10.2: payout_sent to the store owners or the driver, once, key payout-{payoutId}', async () => {
    await ctx.pool.query(
      `INSERT INTO ledger_entries (id, payee_type, payee_id, kind, amount_cents, description, created_at)
       VALUES ('sale_t', 'store', $1, 'sale', 17083, 'Sale', $3), ('delivery_t', 'driver', $2, 'delivery', 4775, 'Delivery', $3)`,
      [owner.storeId, driver.uid, new Date(ctx.clock.now())],
    );
    await ctx.runJob('runDailyPayouts', ctx.clock.now());
    await ctx.drainOutbox();
    await ctx.runJob('runDailyPayouts', ctx.clock.now());
    await ctx.drainOutbox();
    const runKey = runKeyOf(ctx.clock.now());
    assert.deepEqual(
      (await rows({ key: `payout-store_${owner.storeId}_${runKey}` })).map((r) => [r.user_id, r.type]),
      [[owner.uid, 'payout_sent']],
    );
    assert.deepEqual(
      (await rows({ key: `payout-driver_${driver.uid}_${runKey}` })).map((r) => [r.user_id, r.type]),
      [[driver.uid, 'payout_sent']],
    );
  });

  test('notifyStaff, notifyStoreMembers: active recipients only, with exclude and ownersOnly', async () => {
    await inTx(async (tx) => {
      await notifyStaff(tx, { type: 'system', title: 'a', body: 'b', key: 'admins' }, { adminsOnly: true });
      await notifyStaff(tx, { type: 'system', title: 'a', body: 'b', key: 'not-me' }, { exclude: admin.uid });
      await notifyStoreMembers(
        tx,
        owner.storeId,
        { type: 'store_issue', title: 'a', body: 'b', key: 'owners' },
        { ownersOnly: true },
      );
    });
    assert.deepEqual(
      (await rows({ key: 'admins' })).map((r) => r.user_id),
      [admin.uid],
    );
    assert.deepEqual(
      (await rows({ key: 'not-me' })).map((r) => r.user_id),
      [dispatcher.uid],
    );
    assert.deepEqual(
      (await rows({ key: 'owners' })).map((r) => r.user_id),
      [owner.uid],
    );
  });
});
