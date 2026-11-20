/**
 * Support threads and the dispatch ↔ driver chat (MARKETPLACE §6.2, §13.2 → PLATFORM §7.3, §5.3.6):
 * `senderRole` cannot be spoofed (it is not in the input and is derived from the caller); a customer reads only
 * their own thread, a supplier only `store_{own}`; each side resets only its own unread counter; staff alone
 * list threads and change status and assignee; a driver reads only their own chat and posts there only while
 * active.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { ChatMessage, ChatThread, SupportMessage, SupportThread, WithId } from '@instasupply/shared';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { expectError, expectOk, get, post } from '../support/http';

const message = (text: string) => ({ id: randomUUID(), text, context: null });
const chat = (text: string) => ({ id: randomUUID(), text, deliveryId: null, kind: 'text' });

describe('support threads', () => {
  let ctx: TestContext;
  let customerA: ActorClient;
  let customerB: ActorClient;
  let ownerX: ActorClient & { storeId: string };
  let staffX: ActorClient;
  let ownerY: ActorClient & { storeId: string };
  let driver: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;
  before(async () => {
    ctx = await createTestContext();
    customerA = await newCustomer(ctx);
    customerB = await newCustomer(ctx);
    ownerX = await newSupplier(ctx, { store: { id: 'store-x' } });
    staffX = await newSupplier(ctx, { storeId: 'store-x', storeRole: 'staff' });
    ownerY = await newSupplier(ctx, { store: { id: 'store-y' } });
    driver = await newDriver(ctx);
    dispatcher = await newDispatcher(ctx);
    admin = await newAdmin(ctx);
    await expectOk(customerA.post(`/support-threads/${customerA.uid}/messages`, message('hello')));
    await expectOk(staffX.post('/support-threads/store_store-x/messages', message('store hello')));
  });
  after(() => ctx.close());

  test('anonymous callers are unauthenticated', async () => {
    await expectError(get(ctx, '/support-threads'), 'unauthenticated');
    await expectError(get(ctx, `/support-threads/${customerA.uid}`), 'unauthenticated');
    await expectError(
      post(ctx, `/support-threads/${customerA.uid}/messages`, message('x')),
      'unauthenticated',
    );
  });

  test('senderRole cannot be spoofed: an input senderRole is refused, the role comes from the caller', async () => {
    await expectError(
      customerA.post(`/support-threads/${customerA.uid}/messages`, {
        ...message('as staff'),
        senderRole: 'staff',
      }),
      'invalid-argument',
    );
    await expectError(
      customerA.post(`/support-threads/${customerA.uid}/messages`, {
        ...message('as staff'),
        senderId: admin.uid,
      }),
      'invalid-argument',
    );
    const byCustomer = await expectOk(
      customerA.post<SupportMessage>(`/support-threads/${customerA.uid}/messages`, message('mine')),
    );
    assert.equal(byCustomer.senderRole, 'customer');
    assert.equal(byCustomer.senderId, customerA.uid);
    const bySupplier = await expectOk(
      ownerX.post<SupportMessage>('/support-threads/store_store-x/messages', message('ours')),
    );
    assert.equal(bySupplier.senderRole, 'supplier');
    const byStaff = await expectOk(
      dispatcher.post<SupportMessage>(`/support-threads/${customerA.uid}/messages`, message('staff')),
    );
    assert.equal(byStaff.senderRole, 'staff');
  });

  test('a customer reads and posts only in their own thread', async () => {
    await expectOk(customerA.get(`/support-threads/${customerA.uid}`));
    await expectOk(customerA.get(`/support-threads/${customerA.uid}/messages`));
    for (const path of [
      `/support-threads/${customerB.uid}`,
      `/support-threads/${customerB.uid}/messages`,
      '/support-threads/store_store-x',
    ]) {
      await expectError(customerA.get(path), 'permission-denied');
    }
    await expectError(customerB.get(`/support-threads/${customerA.uid}`), 'permission-denied');
    await expectError(
      customerB.post(`/support-threads/${customerA.uid}/messages`, message('not yours')),
      'permission-denied',
    );
    await expectError(customerB.post(`/support-threads/${customerA.uid}/read`), 'permission-denied');
    // Before the first message the own thread is not-found.
    await expectError(customerB.get(`/support-threads/${customerB.uid}`), 'not-found');
  });

  test('a supplier reads only store_{own}; store staff are members too', async () => {
    await expectOk(ownerX.get('/support-threads/store_store-x'));
    await expectOk(staffX.get('/support-threads/store_store-x/messages'));
    await expectError(ownerY.get('/support-threads/store_store-x'), 'permission-denied');
    await expectError(
      ownerY.post('/support-threads/store_store-x/messages', message('x')),
      'permission-denied',
    );
    await expectError(ownerX.get(`/support-threads/${customerA.uid}`), 'permission-denied');
    await expectError(ownerX.get('/support-threads'), 'permission-denied');
  });

  test('drivers have no support thread', async () => {
    await expectError(driver.get(`/support-threads/${driver.uid}`), 'permission-denied');
    await expectError(
      driver.post(`/support-threads/${driver.uid}/messages`, message('x')),
      'permission-denied',
    );
  });

  test('each side resets only its own unread counter', async () => {
    await expectOk(dispatcher.post(`/support-threads/${customerA.uid}/messages`, message('reply')));
    const before = await expectOk(admin.get<WithId<SupportThread>>(`/support-threads/${customerA.uid}`));
    assert.ok(before.unreadByStaff > 0 && before.unreadByOwner > 0);
    await expectOk(customerA.post(`/support-threads/${customerA.uid}/read`), 204);
    const afterOwner = await expectOk(admin.get<WithId<SupportThread>>(`/support-threads/${customerA.uid}`));
    assert.equal(afterOwner.unreadByOwner, 0);
    assert.equal(afterOwner.unreadByStaff, before.unreadByStaff);
    await expectOk(admin.post(`/support-threads/${customerA.uid}/read`), 204);
    const afterStaff = await expectOk(admin.get<WithId<SupportThread>>(`/support-threads/${customerA.uid}`));
    assert.equal(afterStaff.unreadByStaff, 0);
  });

  test('only staff list threads and change status and assignee, and only those keys', async () => {
    for (const actor of [customerA, ownerX, staffX, driver]) {
      await expectError(actor.get('/support-threads'), 'permission-denied');
      await expectError(
        actor.patch(`/support-threads/${customerA.uid}`, { status: 'resolved' }),
        'permission-denied',
      );
    }
    await expectOk(dispatcher.get('/support-threads'));
    await expectOk(
      admin.patch(`/support-threads/${customerA.uid}`, { status: 'resolved', assignedTo: null }),
    );
    await expectError(
      dispatcher.patch(`/support-threads/${customerA.uid}`, { unreadByStaff: 0 }),
      'invalid-argument',
    );
    await expectError(
      dispatcher.patch(`/support-threads/${customerA.uid}`, { assignedName: 'Someone' }),
      'invalid-argument',
    );
  });
});

describe('dispatch ↔ driver chat', () => {
  let ctx: TestContext;
  let driver: ActorClient;
  let otherDriver: ActorClient;
  let pendingDriver: ActorClient;
  let customer: ActorClient;
  let supplier: ActorClient;
  let dispatcher: ActorClient;
  before(async () => {
    ctx = await createTestContext();
    driver = await newDriver(ctx, { displayName: 'Marco Rossi' });
    otherDriver = await newDriver(ctx);
    pendingDriver = await newDriver(ctx, { status: 'pending' });
    customer = await newCustomer(ctx);
    supplier = await newSupplier(ctx);
    dispatcher = await newDispatcher(ctx, { displayName: 'Riley Chen' });
    await expectOk(driver.post(`/threads/${driver.uid}/messages`, chat('at the yard')));
  });
  after(() => ctx.close());

  test('anonymous callers are unauthenticated', async () => {
    await expectError(get(ctx, '/threads'), 'unauthenticated');
    await expectError(post(ctx, `/threads/${driver.uid}/messages`, chat('x')), 'unauthenticated');
  });

  test('a driver reads only their own thread', async () => {
    const thread = await expectOk(driver.get<WithId<ChatThread>>(`/threads/${driver.uid}`));
    assert.equal(thread.id, driver.uid);
    assert.equal(thread.driverName, 'Marco Rossi');
    await expectOk(driver.get(`/threads/${driver.uid}/messages`));
    await expectError(otherDriver.get(`/threads/${driver.uid}`), 'permission-denied');
    await expectError(otherDriver.get(`/threads/${driver.uid}/messages`), 'permission-denied');
    await expectError(driver.get('/threads'), 'permission-denied');
    for (const actor of [customer, supplier]) {
      await expectError(actor.get(`/threads/${driver.uid}`), 'permission-denied');
      await expectError(actor.get('/threads'), 'permission-denied');
    }
  });

  test('a driver posts only in their own thread, only while active, and always as driver', async () => {
    const own = await expectOk(driver.post<ChatMessage>(`/threads/${driver.uid}/messages`, chat('loaded')));
    assert.equal(own.senderRole, 'driver');
    await expectError(
      otherDriver.post(`/threads/${driver.uid}/messages`, chat('hijack')),
      'permission-denied',
    );
    await expectError(
      pendingDriver.post(`/threads/${pendingDriver.uid}/messages`, chat('hello?')),
      'permission-denied',
    );
    await expectError(customer.post(`/threads/${driver.uid}/messages`, chat('x')), 'permission-denied');
    await expectError(
      driver.post(`/threads/${driver.uid}/messages`, { ...chat('as staff'), senderRole: 'staff' }),
      'invalid-argument',
    );
    // A pending driver can still read their own (empty) thread.
    await expectError(pendingDriver.get(`/threads/${pendingDriver.uid}`), 'not-found');
  });

  test('staff post as staff and the driver is notified; each side resets only its own counter', async () => {
    const reply = await expectOk(
      dispatcher.post<ChatMessage>(`/threads/${driver.uid}/messages`, chat('thanks, see you at the site')),
    );
    assert.equal(reply.senderRole, 'staff');
    assert.equal(reply.senderName, 'Riley Chen');
    const before = await expectOk(dispatcher.get<WithId<ChatThread>>(`/threads/${driver.uid}`));
    assert.equal(before.unreadByDriver, 1);
    assert.equal(before.unreadByStaff, 2);
    await expectOk(driver.post(`/threads/${driver.uid}/read`), 204);
    const afterDriver = await expectOk(dispatcher.get<WithId<ChatThread>>(`/threads/${driver.uid}`));
    assert.equal(afterDriver.unreadByDriver, 0);
    assert.equal(afterDriver.unreadByStaff, 2);
    await expectError(otherDriver.post(`/threads/${driver.uid}/read`), 'permission-denied');
    await expectOk(dispatcher.post(`/threads/${driver.uid}/read`), 204);
    const afterStaff = await expectOk(dispatcher.get<WithId<ChatThread>>(`/threads/${driver.uid}`));
    assert.equal(afterStaff.unreadByStaff, 0);
    const list = await expectOk(dispatcher.get<{ items: WithId<ChatThread>[] }>('/threads'));
    assert.deepEqual(
      list.items.map((t) => t.id),
      [driver.uid],
    );
    const { rows } = await ctx.pool.query<{ user_id: string; type: string; title: string }>(
      `SELECT user_id, type, title FROM notifications WHERE dedupe_key = $1`,
      [`chat-${reply.id}`],
    );
    assert.deepEqual(rows, [{ user_id: driver.uid, type: 'chat_message', title: 'Dispatch · Riley Chen' }]);
  });

  test('staff cannot open a chat with someone who is not a driver', async () => {
    await expectError(dispatcher.post(`/threads/${customer.uid}/messages`, chat('hi')), 'not-found');
  });
});
