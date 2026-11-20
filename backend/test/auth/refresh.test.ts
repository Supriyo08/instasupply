import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  call,
  createTestContext,
  get,
  loginAccount,
  post,
  registerAccount,
  type ErrorBody,
  type SessionBody,
  type TestContext,
} from '../platform/context';

const DAY = 86_400_000;

describe('refresh with rotation and reuse detection (§6.3.5)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  const refresh = (token: string) =>
    post<SessionBody & ErrorBody>(ctx, '/auth/refresh', { refreshToken: token });

  test('rotation answers a new pair and me; the access token works', async () => {
    const first = await registerAccount(ctx, { email: 'rot@example.com' });
    const next = await refresh(first.refreshToken);
    assert.equal(next.status, 200);
    assert.notEqual(next.body.refreshToken, first.refreshToken);
    assert.equal(next.body.sessionId, first.sessionId);
    assert.equal(next.body.me.account.uid, first.me.account.uid);
    const me = await get(ctx, '/me', next.body.accessToken);
    assert.equal(me.status, 200);
  });

  test('a repeat after a lost answer works at any age while its child is unused', async () => {
    const first = await registerAccount(ctx, { email: 'repeat@example.com' });
    const lost = await refresh(first.refreshToken);
    assert.equal(lost.status, 200);
    ctx.clock.advance(2 * 60_000);
    const repeat = await refresh(first.refreshToken);
    assert.equal(repeat.status, 200);
    const { rows } = await ctx.pool.query('SELECT revoked_at FROM sessions WHERE id = $1', [first.sessionId]);
    assert.equal(rows[0]!.revoked_at, null);
  });

  test('replay after the child was used revokes the session, also 2 days later', async () => {
    const first = await registerAccount(ctx, { email: 'reuse@example.com' });
    const child = await refresh(first.refreshToken);
    const grandchild = await refresh(child.body.refreshToken);
    assert.equal(grandchild.status, 200);
    ctx.clock.advance(2 * DAY);
    const replay = await refresh(first.refreshToken);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.details.reason, 'refresh_reused');
    const { rows } = await ctx.pool.query('SELECT revoked_reason FROM sessions WHERE id = $1', [
      first.sessionId,
    ]);
    assert.equal(rows[0]!.revoked_reason, 'reuse_detected');
    // The thief and the owner both have to sign in again.
    const after = await refresh(grandchild.body.refreshToken);
    assert.equal(after.body.error.details.reason, 'session_revoked');
  });

  test('a superseded sibling revokes the session', async () => {
    const first = await registerAccount(ctx, { email: 'sibling@example.com' });
    const c1 = await refresh(first.refreshToken);
    const c2 = await refresh(first.refreshToken);
    assert.equal((await refresh(c1.body.refreshToken)).status, 200);
    const late = await refresh(c2.body.refreshToken);
    assert.equal(late.body.error.details.reason, 'refresh_reused');
  });

  test('at most 5 repeats; the sixth is reuse', async () => {
    const first = await registerAccount(ctx, { email: 'six@example.com' });
    for (let i = 0; i < 5; i += 1) assert.equal((await refresh(first.refreshToken)).status, 200);
    const sixth = await refresh(first.refreshToken);
    assert.equal(sixth.body.error.details.reason, 'refresh_reused');
  });

  test('a malformed or unknown token is token_invalid', async () => {
    assert.equal((await refresh('nope')).body.error.details.reason, 'token_invalid');
    const fake = `isr_${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.${'A'.repeat(43)}`;
    assert.equal((await refresh(fake)).body.error.details.reason, 'token_invalid');
  });

  test('expiry: past 60 days the token is token_expired', async () => {
    const first = await registerAccount(ctx, { email: 'old@example.com' });
    ctx.clock.advance(61 * DAY);
    const answer = await refresh(first.refreshToken);
    assert.equal(answer.body.error.details.reason, 'token_expired');
  });

  test('the sliding lifetime never passes the session end', async () => {
    const first = await registerAccount(ctx, { email: 'slide@example.com' });
    const { rows } = await ctx.pool.query<{ expires_at: number }>(
      'SELECT expires_at FROM sessions WHERE id = $1',
      [first.sessionId],
    );
    let token = first.refreshToken;
    for (let i = 0; i < 3; i += 1) {
      ctx.clock.advance(50 * DAY);
      const next = await refresh(token);
      assert.equal(next.status, 200, JSON.stringify(next.body));
      assert.ok(next.body.refreshTokenExpiresAt <= rows[0]!.expires_at);
      token = next.body.refreshToken;
    }
    // Day 200: past SESSION_MAX_DAYS (180), however recently the token was rotated.
    ctx.clock.advance(50 * DAY);
    assert.equal((await refresh(token)).body.error.details.reason, 'token_expired');
  });

  test('suspension answers account_suspended, never session_revoked', async () => {
    const session = await accountWithRole(ctx, 'sus-refresh@example.com', 'customer');
    await ctx.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [session.me.account.uid]);
    const answer = await refresh(session.refreshToken);
    assert.equal(answer.status, 403);
    assert.equal(answer.body.error.details.reason, 'account_suspended');
    const again = await refresh(session.refreshToken);
    assert.equal(again.body.error.details.reason, 'account_suspended');
  });
});

describe('log out and revocation clean-up (§6.3.6)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  async function driverWithDevice(email: string) {
    const session = await registerAccount(ctx, { email, app: 'driver', installationId: `${email}-phone` });
    const uid = session.me.account.uid;
    await ctx.pool.query(`UPDATE users SET role = 'driver', status = 'active' WHERE id = $1`, [uid]);
    await ctx.pool.query(
      `INSERT INTO devices (user_id, installation_id, token, provider, platform, app, created_at, last_seen_at)
       VALUES ($1, $2, $3, 'expo', 'android', 'driver', now(), now())`,
      [uid, `${email}-phone`, `ExponentPushToken[${email}]`],
    );
    await ctx.pool.query(
      `INSERT INTO driver_locations (driver_id, lat, lng, online, updated_at) VALUES ($1, 43.65, -79.38, true, now())`,
      [uid],
    );
    return session;
  }

  const state = async (uid: string) => {
    const devices = await ctx.pool.query('SELECT 1 FROM devices WHERE user_id = $1', [uid]);
    const location = await ctx.pool.query<{ online: boolean }>(
      'SELECT online FROM driver_locations WHERE driver_id = $1',
      [uid],
    );
    return { devices: devices.rowCount, online: location.rows[0]?.online };
  };

  test('logout needs no access token, takes the driver offline and deletes the device', async () => {
    const session = await driverWithDevice('d1@example.com');
    const answer = await call(ctx, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(answer.status, 204);
    assert.deepEqual(await state(session.me.account.uid), { devices: 0, online: false });
    const me = await get<ErrorBody>(ctx, '/me', session.accessToken);
    assert.equal(me.body.error.details.reason, 'session_revoked');
    // Unknown or already revoked: still 204.
    const again = await call(ctx, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(again.status, 204);
    const junk = await call(ctx, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: 'junk' },
    });
    assert.equal(junk.status, 204);
  });

  test('logout-all revokes every session of the caller', async () => {
    const first = await driverWithDevice('d2@example.com');
    const second = await loginAccount(ctx, { email: 'd2@example.com', app: 'driver' });
    const answer = await call(ctx, {
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      token: second.body.accessToken,
    });
    assert.equal(answer.status, 204);
    assert.equal((await get<ErrorBody>(ctx, '/me', first.accessToken)).status, 401);
    assert.equal((await get<ErrorBody>(ctx, '/me', second.body.accessToken)).status, 401);
    assert.deepEqual(await state(first.me.account.uid), { devices: 0, online: false });
  });

  test("an admin's revoke-all ends every session of another account; not on oneself", async () => {
    const admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
    const driver = await driverWithDevice('d3@example.com');
    const self = await call<ErrorBody>(ctx, {
      method: 'POST',
      url: `/api/v1/users/${admin.me.account.uid}/sessions/revoke-all`,
      token: admin.accessToken,
    });
    assert.equal(self.status, 403);
    const answer = await call(ctx, {
      method: 'POST',
      url: `/api/v1/users/${driver.me.account.uid}/sessions/revoke-all`,
      token: admin.accessToken,
    });
    assert.equal(answer.status, 204);
    assert.deepEqual(await state(driver.me.account.uid), { devices: 0, online: false });
    const { rows } = await ctx.pool.query('SELECT revoked_reason FROM sessions WHERE user_id = $1', [
      driver.me.account.uid,
    ]);
    assert.deepEqual(
      rows.map((r) => r.revoked_reason),
      ['admin'],
    );
  });

  test('GET /auth/sessions lists the active sessions and marks the current one; DELETE revokes one', async () => {
    const a = await registerAccount(ctx, { email: 'multi@example.com', installationId: 'multi-install-a' });
    const b = await loginAccount(ctx, { email: 'multi@example.com', installationId: 'multi-install-b' });
    const list = await get<{ items: { id: string; current: boolean }[] }>(
      ctx,
      '/auth/sessions',
      a.accessToken,
    );
    assert.equal(list.body.items.length, 2);
    assert.equal(list.body.items.find((s) => s.current)?.id, a.sessionId);
    const removed = await call(ctx, {
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${b.body.sessionId}`,
      token: a.accessToken,
    });
    assert.equal(removed.status, 204);
    assert.equal((await get(ctx, '/me', b.body.accessToken)).status, 401);
  });
});
