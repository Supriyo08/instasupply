import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { signAccessToken } from '../../src/platform/auth/tokens';
import {
  accountWithRole,
  call,
  command,
  createTestContext,
  get,
  insertStore,
  type ErrorBody,
  type TestContext,
} from '../platform/context';

describe('enforcement on every request (§6.4)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext({
      env: { JWT_SECRET_PREVIOUS: 'previous-secret-0123456789abcdef-0123456789' },
    });
    await insertStore(ctx, 'kestrel-lumber');
  });
  after(() => ctx.close());

  const patchStatus = (token: string, uid: string, body: unknown) =>
    call<ErrorBody & { status: string }>(ctx, {
      method: 'PATCH',
      url: `/api/v1/users/${uid}/status`,
      payload: body as Record<string, unknown>,
      token,
    });

  test('a suspension takes effect on the next request with account_suspended', async () => {
    const admin = await accountWithRole(ctx, 'admin1@example.com', 'admin');
    const customer = await accountWithRole(ctx, 'cust@example.com', 'customer');
    assert.equal((await get(ctx, '/me', customer.accessToken)).status, 200);
    const suspended = await patchStatus(admin.accessToken, customer.me.account.uid, {
      status: 'suspended',
      reason: 'Chargebacks',
    });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    assert.equal(suspended.body.status, 'suspended');
    const me = await get<ErrorBody>(ctx, '/me', customer.accessToken);
    assert.equal(me.status, 403);
    assert.equal(me.body.error.details.reason, 'account_suspended');
    const { rows } = await ctx.pool.query('SELECT DISTINCT revoked_reason FROM sessions WHERE user_id = $1', [
      customer.me.account.uid,
    ]);
    assert.deepEqual(rows, [{ revoked_reason: 'suspended' }]);
    // Reactivation only sets the status back; the old session stays ended.
    const active = await patchStatus(admin.accessToken, customer.me.account.uid, {
      status: 'active',
      reason: null,
    });
    assert.equal(active.body.status, 'active');
  });

  test('PATCH /users/{uid}/status: dispatchers yes, drivers no, never the last admin, never oneself', async () => {
    const admin = await accountWithRole(ctx, 'admin2@example.com', 'admin');
    const dispatcher = await accountWithRole(ctx, 'disp@example.com', 'dispatcher');
    const driver = await accountWithRole(ctx, 'drv@example.com', 'driver');
    assert.equal(
      (
        await patchStatus(admin.accessToken, dispatcher.me.account.uid, {
          status: 'suspended',
          reason: 'Left',
        })
      ).status,
      200,
    );
    assert.equal(
      (await patchStatus(admin.accessToken, driver.me.account.uid, { status: 'suspended', reason: 'x' }))
        .status,
      412,
    );
    assert.equal(
      (await patchStatus(admin.accessToken, admin.me.account.uid, { status: 'suspended', reason: 'x' }))
        .status,
      403,
    );
    const noReason = await patchStatus(admin.accessToken, dispatcher.me.account.uid, {
      status: 'suspended',
      reason: null,
    });
    assert.equal(noReason.status, 400);
    // Suspend every other admin, then the last one cannot be suspended.
    const others = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1`,
      [admin.me.account.uid],
    );
    for (const row of others.rows)
      await patchStatus(admin.accessToken, row.id, { status: 'suspended', reason: 'Test' });
    const second = await accountWithRole(ctx, 'admin3@example.com', 'admin');
    assert.equal(
      (await patchStatus(second.accessToken, admin.me.account.uid, { status: 'suspended', reason: 'x' }))
        .status,
      200,
    );
    const last = await patchStatus(second.accessToken, second.me.account.uid, {
      status: 'suspended',
      reason: 'x',
    });
    assert.equal(last.status, 403);
  });

  test('a role or store change needs no new token', async () => {
    const user = await accountWithRole(ctx, 'grow@example.com', 'customer');
    const before = await get<{ profile: { role: string } }>(ctx, '/me', user.accessToken);
    assert.equal(before.body.profile.role, 'customer');
    await ctx.pool.query(
      `UPDATE users SET role = 'supplier', store_id = 'kestrel-lumber', store_role = 'staff' WHERE id = $1`,
      [user.me.account.uid],
    );
    const after = await get<{ profile: { role: string; storeId: string }; store: { id: string } }>(
      ctx,
      '/me',
      user.accessToken,
    );
    assert.equal(after.body.profile.role, 'supplier');
    assert.equal(after.body.store.id, 'kestrel-lumber');
  });

  test("a revoked session's access token is refused before it expires", async () => {
    const user = await accountWithRole(ctx, 'rev@example.com', 'customer');
    await ctx.pool.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1`, [
      user.sessionId,
    ]);
    const me = await get<ErrorBody>(ctx, '/me', user.accessToken);
    assert.equal(me.body.error.details.reason, 'session_revoked');
  });

  test('JWT_SECRET_PREVIOUS is accepted; an expired token answers token_expired', async () => {
    const user = await accountWithRole(ctx, 'rot@example.com', 'customer');
    const old = await signAccessToken(
      { ...ctx.config, JWT_SECRET: ctx.config.JWT_SECRET_PREVIOUS! },
      { uid: user.me.account.uid, sessionId: user.sessionId, now: ctx.clock.now() },
    );
    assert.equal((await get(ctx, '/me', old)).status, 200);
    const forged = await signAccessToken(
      { ...ctx.config, JWT_SECRET: 'some-other-secret-0123456789abcdef-012345' },
      { uid: user.me.account.uid, sessionId: user.sessionId, now: ctx.clock.now() },
    );
    assert.equal((await get<ErrorBody>(ctx, '/me', forged)).body.error.details.reason, 'token_invalid');
    ctx.clock.advance(16 * 60_000);
    assert.equal(
      (await get<ErrorBody>(ctx, '/me', user.accessToken)).body.error.details.reason,
      'token_expired',
    );
  });

  test('setSupplierUserStatus: the owner suspends staff of their own store, not themselves', async () => {
    const owner = await accountWithRole(ctx, 'own@example.com', 'supplier', {
      storeId: 'kestrel-lumber',
      storeRole: 'owner',
    });
    const staff = await accountWithRole(ctx, 'yard@example.com', 'supplier', {
      storeId: 'kestrel-lumber',
      storeRole: 'staff',
    });
    const self = await command<ErrorBody>(
      ctx,
      'setSupplierUserStatus',
      { uid: owner.me.account.uid, status: 'suspended' },
      owner.accessToken,
    );
    assert.equal(self.status, 403);
    const ok = await command(
      ctx,
      'setSupplierUserStatus',
      { uid: staff.me.account.uid, status: 'suspended', reason: 'Left' },
      owner.accessToken,
    );
    assert.equal(ok.status, 200);
    assert.equal(
      (await get<ErrorBody>(ctx, '/me', staff.accessToken)).body.error.details.reason,
      'account_suspended',
    );
  });
});
