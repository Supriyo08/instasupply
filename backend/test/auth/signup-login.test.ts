import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  command,
  createTestContext,
  get,
  loginAccount,
  PASSWORD,
  post,
  registerAccount,
  type ErrorBody,
  type SessionBody,
  type TestContext,
} from '../platform/context';

describe('register and log in (§6.3.1, §6.3.4)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('register creates a role-less account and signs it in', async () => {
    const session = await registerAccount(ctx, { email: 'Dana@Example.com', displayName: 'Dana  W' });
    assert.match(session.refreshToken, /^isr_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(session.accessTokenTtlSeconds, 900);
    assert.equal(session.me.account.email, 'dana@example.com');
    assert.equal(session.me.profile, null);
    const me = await get<{ account: { uid: string }; profile: null }>(ctx, '/me', session.accessToken);
    assert.equal(me.status, 200);
    assert.equal(me.body.account.uid, session.me.account.uid);
  });

  test('a duplicate email is already-exists, whatever its case', async () => {
    const again = await post<ErrorBody>(ctx, '/auth/register', {
      email: 'DANA@example.com',
      password: PASSWORD,
      displayName: '',
      installationId: 'install-dup-1',
      app: 'customer',
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.status, 'already-exists');
  });

  test('a weak password and the console app are refused at sign-up', async () => {
    const weak = await post<ErrorBody>(ctx, '/auth/register', {
      email: 'weak@example.com',
      password: 'short',
      displayName: 'Weak',
      installationId: 'install-weak',
      app: 'customer',
    });
    assert.equal(weak.status, 400);
    assert.ok(weak.body.error.details.fields);
    const consoleApp = await post<ErrorBody>(ctx, '/auth/register', {
      email: 'console@example.com',
      password: PASSWORD,
      displayName: 'Console',
      installationId: 'install-console',
      app: 'console',
    });
    assert.equal(consoleApp.status, 400);
  });

  test('an unknown key in the body is invalid-argument (strict schemas)', async () => {
    const answer = await post<ErrorBody>(ctx, '/auth/register', {
      email: 'extra@example.com',
      password: PASSWORD,
      displayName: 'Extra',
      installationId: 'install-extra',
      app: 'customer',
      role: 'admin',
    });
    assert.equal(answer.status, 400);
  });

  test('login succeeds, and wrong password and unknown email answer the same', async () => {
    const ok = await loginAccount(ctx, { email: 'dana@example.com', installationId: 'install-dana-1' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.accessToken);
    const wrong = await loginAccount(ctx, { email: 'dana@example.com', password: 'Wrong12345' });
    const unknown = await loginAccount(ctx, { email: 'nobody@example.com' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const a = wrong.body as unknown as ErrorBody;
    const b = unknown.body as unknown as ErrorBody;
    assert.deepEqual(a.error, b.error);
    assert.equal(a.error.details.reason, 'credentials');
  });

  test('the hash carries its parameters; a weaker stored hash is upgraded at login', async () => {
    const read = async () =>
      (
        await ctx.pool.query<{ password_hash: string }>(
          `SELECT password_hash FROM users WHERE email = 'dana@example.com'`,
        )
      ).rows[0]!.password_hash;
    assert.match(await read(), /^scrypt\$N=1024,r=8,p=1\$/);
    const salt = randomBytes(16);
    const key = scryptSync(PASSWORD.normalize('NFKC'), salt, 32, { N: 512, r: 8, p: 1 });
    const weak = ['scrypt', 'N=512,r=8,p=1', salt.toString('base64url'), key.toString('base64url')].join('$');
    await ctx.pool.query(`UPDATE users SET password_hash = $1 WHERE email = 'dana@example.com'`, [weak]);
    const ok = await loginAccount(ctx, { email: 'dana@example.com' });
    assert.equal(ok.status, 200);
    assert.match(await read(), /^scrypt\$N=1024,r=8,p=1\$/);
  });

  test('a suspended account learns it only with the right password', async () => {
    const session = await accountWithRole(ctx, 'sus@example.com', 'customer');
    await ctx.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [session.me.account.uid]);
    const wrong = await loginAccount(ctx, { email: 'sus@example.com', password: 'Nope12345' });
    assert.equal((wrong.body as unknown as ErrorBody).error.details.reason, 'credentials');
    const right = await loginAccount(ctx, { email: 'sus@example.com' });
    assert.equal(right.status, 403);
    assert.equal((right.body as unknown as ErrorBody).error.details.reason, 'account_suspended');
  });

  test('registerCustomer turns a role-less account into an active customer', async () => {
    const session = await registerAccount(ctx, { email: 'newcustomer@example.com' });
    const answer = await command<{ status: string }>(
      ctx,
      'registerCustomer',
      { displayName: 'New Customer' },
      session.accessToken,
    );
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { status: 'active' });
    const me = await get<{ profile: { role: string } | null }>(ctx, '/me', session.accessToken);
    assert.equal(me.body.profile?.role, 'customer');
  });

  test('at most 10 active sessions per user; the same install replaces its session', async () => {
    const email = 'many@example.com';
    await registerAccount(ctx, { email, installationId: 'install-many-0' });
    const again = await loginAccount(ctx, { email, installationId: 'install-many-0' });
    assert.equal(again.status, 200);
    for (let i = 1; i <= 11; i += 1) await loginAccount(ctx, { email, installationId: `install-many-${i}` });
    const { rows } = await ctx.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email = $1 AND s.revoked_at IS NULL`,
      [email],
    );
    assert.equal(rows[0]!.n, 10);
  });
});

describe('login_email limit (§6.3.4 step 3)', () => {
  let ctx: TestContext;
  let owner: SessionBody;
  before(async () => {
    ctx = await createTestContext({ env: { RATE_LIMITS_DISABLED: 'false', TRUST_PROXY: 'true' } });
    owner = await registerAccount(ctx, { email: 'owner@example.com', installationId: 'owner-phone-1' });
  });
  after(() => ctx.close());

  const attempt = (email: string, ip: string, installationId: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-real-ip': ip },
      payload: { email, password: 'Wrong12345', installationId, app: 'customer' },
    });

  test('after 10 attempts from other addresses, unknown and existing emails get the identical answer', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('owner@example.com', `198.51.100.${i + 1}`, `attacker-${i}`);
      await attempt('ghost@example.com', `198.51.100.${i + 1}`, `attacker-${i}`);
    }
    const existing = await attempt('owner@example.com', '198.51.100.99', 'attacker-x');
    const unknown = await attempt('ghost@example.com', '198.51.100.99', 'attacker-x');
    assert.equal(existing.statusCode, 429);
    assert.equal(unknown.statusCode, 429);
    const a = JSON.parse(existing.body) as ErrorBody;
    const b = JSON.parse(unknown.body) as ErrorBody;
    assert.equal(a.error.code, 'RATE_LIMITED');
    assert.equal(a.error.message, b.error.message);
    assert.equal(typeof a.error.details.retryAfterMs, 'number');
  });

  test("the owner's known installation still signs in", async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-real-ip': '203.0.113.7' },
      payload: {
        email: 'owner@example.com',
        password: PASSWORD,
        installationId: 'owner-phone-1',
        app: 'customer',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(owner.me.account.uid);
  });
});
