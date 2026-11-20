import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  createTestContext,
  get,
  insertStore,
  type SessionBody,
  type TestContext,
} from '../platform/context';

describe('users (MARKETPLACE §6.2 → PLATFORM §7.3)', () => {
  let ctx: TestContext;
  let admin: SessionBody;
  let dispatcher: SessionBody;
  let customerA: SessionBody;
  let customerB: SessionBody;
  let ownerX: SessionBody;
  let staffX: SessionBody;
  let ownerY: SessionBody;
  before(async () => {
    ctx = await createTestContext();
    await insertStore(ctx, 'store-x');
    await insertStore(ctx, 'store-y');
    admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
    dispatcher = await accountWithRole(ctx, 'disp@example.com', 'dispatcher');
    customerA = await accountWithRole(ctx, 'a@example.com', 'customer');
    customerB = await accountWithRole(ctx, 'b@example.com', 'customer');
    ownerX = await accountWithRole(ctx, 'ox@example.com', 'supplier', {
      storeId: 'store-x',
      storeRole: 'owner',
    });
    staffX = await accountWithRole(ctx, 'sx@example.com', 'supplier', {
      storeId: 'store-x',
      storeRole: 'staff',
    });
    ownerY = await accountWithRole(ctx, 'oy@example.com', 'supplier', {
      storeId: 'store-y',
      storeRole: 'owner',
    });
  });
  after(() => ctx.close());

  test('anonymous: GET /me and GET /users are unauthenticated', async () => {
    assert.equal((await get(ctx, '/me')).status, 401);
    assert.equal((await get(ctx, '/users')).status, 401);
  });

  test('a user reads their own profile only', async () => {
    assert.equal((await get(ctx, `/users/${customerA.me.account.uid}`, customerA.accessToken)).status, 200);
    assert.equal((await get(ctx, `/users/${customerB.me.account.uid}`, customerA.accessToken)).status, 403);
  });

  test('staff read all', async () => {
    for (const staff of [admin, dispatcher]) {
      const list = await get<{ items: unknown[] }>(ctx, '/users', staff.accessToken);
      assert.equal(list.status, 200);
      assert.equal(list.body.items.length, 7);
      assert.equal((await get(ctx, `/users/${customerB.me.account.uid}`, staff.accessToken)).status, 200);
    }
  });

  test('an owner lists only the supplier users of their own store', async () => {
    const own = await get<{ items: { storeId: string }[] }>(
      ctx,
      '/users?role=supplier&storeId=store-x',
      ownerX.accessToken,
    );
    assert.equal(own.status, 200);
    assert.deepEqual(
      own.body.items.map((u) => u.storeId),
      ['store-x', 'store-x'],
    );
    assert.equal((await get(ctx, '/users?role=supplier&storeId=store-y', ownerX.accessToken)).status, 403);
    assert.equal((await get(ctx, '/users?role=customer', ownerX.accessToken)).status, 403);
    assert.equal((await get(ctx, '/users?role=supplier&storeId=store-x', staffX.accessToken)).status, 403);
    assert.equal((await get(ctx, '/users?role=supplier&storeId=store-x', ownerY.accessToken)).status, 403);
    assert.equal((await get(ctx, '/users', customerA.accessToken)).status, 403);
  });

  test('staff list several roles at once (the Team page asks for admin,dispatcher)', async () => {
    const list = await get<{ items: { role: string }[] }>(
      ctx,
      '/users?role=admin,dispatcher',
      admin.accessToken,
    );
    assert.equal(list.status, 200);
    const roles = new Set(list.body.items.map((item) => item.role));
    assert.ok(roles.has('admin') && roles.has('dispatcher'));
    assert.ok([...roles].every((role) => role === 'admin' || role === 'dispatcher'));
    assert.equal((await get(ctx, '/users?role=admin,boss', admin.accessToken)).status, 400);
    // A supplier owner may still list only their own store's suppliers, one role.
    assert.equal(
      (await get(ctx, '/users?role=supplier,customer&storeId=store-x', admin.accessToken)).status,
      200,
    );
  });

  test('a profile never carries authentication columns', async () => {
    const me = await get<{ profile: Record<string, unknown> }>(ctx, '/me', customerA.accessToken);
    const keys = Object.keys(me.body.profile);
    for (const hidden of ['password_hash', 'passwordHash', 'failed_logins', 'failedLogins'])
      assert.ok(!keys.includes(hidden));
  });
});
