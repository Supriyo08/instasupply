import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  createTestContext,
  get,
  loginAccount,
  PASSWORD,
  post,
  registerAccount,
  type ErrorBody,
  type TestContext,
} from '../platform/context';

const NEW_PASSWORD = 'Concrete2027';

describe('change and reset a password (§6.3.7)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  async function latestResetCode(email: string): Promise<string> {
    await ctx.drainOutbox();
    const { rows } = await ctx.pool.query<{ body: string; sensitive: boolean; purpose: string }>(
      `SELECT body, sensitive, purpose FROM dev_outbox WHERE to_address = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [email],
    );
    const row = rows[0]!;
    assert.equal(row.purpose, 'password_reset');
    assert.equal(row.sensitive, true);
    return /(\d{6})/.exec(row.body)![1]!;
  }

  test('change keeps the current session and revokes the others', async () => {
    const a = await registerAccount(ctx, { email: 'change@example.com', installationId: 'change-device-a' });
    const b = await loginAccount(ctx, { email: 'change@example.com', installationId: 'change-device-b' });
    const wrong = await post<ErrorBody>(
      ctx,
      '/auth/password/change',
      { currentPassword: 'Wrong12345', newPassword: NEW_PASSWORD },
      a.accessToken,
    );
    assert.equal(wrong.status, 400);
    const ok = await post(
      ctx,
      '/auth/password/change',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      a.accessToken,
    );
    assert.equal(ok.status, 204);
    assert.equal((await get(ctx, '/me', a.accessToken)).status, 200);
    assert.equal((await get(ctx, '/me', b.body.accessToken)).status, 401);
    assert.equal(
      (await loginAccount(ctx, { email: 'change@example.com', password: NEW_PASSWORD })).status,
      200,
    );
  });

  test('forgot never reveals whether the email exists', async () => {
    const known = await post(ctx, '/auth/password/forgot', { email: 'change@example.com' });
    const unknown = await post(ctx, '/auth/password/forgot', { email: 'nobody@example.com' });
    assert.equal(known.status, 204);
    assert.equal(unknown.status, 204);
    await ctx.drainOutbox();
    const { rows } = await ctx.pool.query(`SELECT 1 FROM dev_outbox WHERE to_address = 'nobody@example.com'`);
    assert.equal(rows.length, 0);
  });

  test('reset: the code is single use and signs every session out', async () => {
    const a = await registerAccount(ctx, { email: 'reset@example.com' });
    await post(ctx, '/auth/password/forgot', { email: 'reset@example.com' });
    const code = await latestResetCode('reset@example.com');
    const ok = await post(ctx, '/auth/password/reset', {
      email: 'reset@example.com',
      code,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(ok.status, 204);
    assert.equal((await get(ctx, '/me', a.accessToken)).status, 401);
    const again = await post<ErrorBody>(ctx, '/auth/password/reset', {
      email: 'reset@example.com',
      code,
      newPassword: 'Another2028',
    });
    assert.equal(again.status, 400);
    assert.equal(again.body.error.message, 'That code is incorrect or has expired.');
    assert.equal(
      (await loginAccount(ctx, { email: 'reset@example.com', password: NEW_PASSWORD })).status,
      200,
    );
  });

  test('reset: a code expires after 15 minutes and allows 5 attempts', async () => {
    await registerAccount(ctx, { email: 'expire@example.com' });
    await post(ctx, '/auth/password/forgot', { email: 'expire@example.com' });
    const code = await latestResetCode('expire@example.com');
    for (let i = 0; i < 5; i += 1) {
      await post(ctx, '/auth/password/reset', {
        email: 'expire@example.com',
        code: '000000',
        newPassword: NEW_PASSWORD,
      });
    }
    const locked = await post(ctx, '/auth/password/reset', {
      email: 'expire@example.com',
      code,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(locked.status, 400);

    await post(ctx, '/auth/password/forgot', { email: 'expire@example.com' });
    const fresh = await latestResetCode('expire@example.com');
    ctx.clock.advance(16 * 60_000);
    const late = await post(ctx, '/auth/password/reset', {
      email: 'expire@example.com',
      code: fresh,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(late.status, 400);
  });

  test('after 10 wrong codes in 24 h forgot issues no code (still 204) and admins are notified', async () => {
    const admin = await accountWithRole(ctx, 'ops@example.com', 'admin');
    const victim = await registerAccount(ctx, { email: 'victim@example.com' });
    for (let round = 0; round < 2; round += 1) {
      await post(ctx, '/auth/password/forgot', { email: 'victim@example.com' });
      await ctx.drainOutbox();
      for (let i = 0; i < 5; i += 1) {
        await post(ctx, '/auth/password/reset', {
          email: 'victim@example.com',
          code: '999999',
          newPassword: NEW_PASSWORD,
        });
      }
    }
    const { rows: before } = await ctx.pool.query(
      'SELECT count(*)::int AS n FROM dev_outbox WHERE to_address = $1',
      ['victim@example.com'],
    );
    const forgot = await post(ctx, '/auth/password/forgot', { email: 'victim@example.com' });
    assert.equal(forgot.status, 204);
    await ctx.drainOutbox();
    const { rows: afterRows } = await ctx.pool.query(
      'SELECT count(*)::int AS n FROM dev_outbox WHERE to_address = $1',
      ['victim@example.com'],
    );
    assert.equal(afterRows[0]!.n, before[0]!.n);
    const { rows: alerts } = await ctx.pool.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM notifications WHERE user_id = $1 AND type = 'system'`,
      [admin.me.account.uid],
    );
    assert.ok(alerts.some((row) => row.dedupe_key.startsWith(`reset-locked-${victim.me.account.uid}-`)));
  });

  test('reset: a burst of parallel wrong guesses is counted in full, and the code is then dead', async () => {
    const session = await registerAccount(ctx, { email: 'burst@example.com' });
    await post(ctx, '/auth/password/forgot', { email: 'burst@example.com' });
    const code = await latestResetCode('burst@example.com');
    const wrongCode = code === '000000' ? '111111' : '000000';
    const answers = await Promise.all(
      Array.from({ length: 40 }, () =>
        post(ctx, '/auth/password/reset', {
          email: 'burst@example.com',
          code: wrongCode,
          newPassword: NEW_PASSWORD,
        }),
      ),
    );
    assert.ok(answers.every((answer) => answer.status === 400));
    const { rows } = await ctx.pool.query<{ attempts: number }>(
      `SELECT t.attempts FROM auth_tokens t JOIN users u ON u.id = t.user_id
        WHERE u.email = 'burst@example.com' AND t.purpose = 'password_reset'`,
    );
    // Only 5 guesses were judged; the other 35 were refused without a comparison.
    assert.deepEqual(
      rows.map((row) => row.attempts),
      [5],
    );
    const { rows: fails } = await ctx.pool.query<{ count: number }>(
      `SELECT r.count FROM rate_limits r JOIN users u ON u.id::text = r.subject
        WHERE r.bucket = 'reset_fail_user' AND u.email = 'burst@example.com'`,
    );
    assert.equal(fails[0]!.count, 5);
    const right = await post(ctx, '/auth/password/reset', {
      email: 'burst@example.com',
      code,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(right.status, 400);
    assert.equal((await get(ctx, '/me', session.accessToken)).status, 200);
  });

  test('reset: the right code sent twice at once changes the password once', async () => {
    await registerAccount(ctx, { email: 'twice@example.com' });
    await post(ctx, '/auth/password/forgot', { email: 'twice@example.com' });
    const code = await latestResetCode('twice@example.com');
    const answers = await Promise.all(
      ['Twice20271', 'Twice20272'].map((newPassword) =>
        post(ctx, '/auth/password/reset', { email: 'twice@example.com', code, newPassword }),
      ),
    );
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [204, 400]);
  });

  test('the reset mail is a sensitive outbox row that only admins can read (outbox payload emptied)', async () => {
    await post(ctx, '/auth/password/forgot', { email: 'change@example.com' });
    await ctx.drainOutbox();
    const { rows } = await ctx.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE event = 'mail.send' AND status = 'done' ORDER BY id DESC LIMIT 1`,
    );
    assert.deepEqual(rows[0]!.payload, {});
  });
});

describe('password change limit (password_change, 10 per 15 minutes per account)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext({ env: { RATE_LIMITS_DISABLED: 'false' } });
  });
  after(() => ctx.close());

  test('the 11th change attempt in 15 minutes is refused before the password is checked', async () => {
    const session = await registerAccount(ctx, { email: 'guesser@example.com' });
    for (let i = 0; i < 10; i += 1) {
      const wrong = await post(
        ctx,
        '/auth/password/change',
        { currentPassword: `Wrong1234${i}`, newPassword: NEW_PASSWORD },
        session.accessToken,
      );
      assert.equal(wrong.status, 400);
    }
    const limited = await post<ErrorBody>(
      ctx,
      '/auth/password/change',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      session.accessToken,
    );
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    ctx.clock.advance(15 * 60_000 + 1);
    // The access token has expired with the window; a fresh sign-in gives a new one.
    const fresh = await loginAccount(ctx, { email: 'guesser@example.com' });
    const ok = await post(
      ctx,
      '/auth/password/change',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      fresh.body.accessToken,
    );
    assert.equal(ok.status, 204);
  });
});
