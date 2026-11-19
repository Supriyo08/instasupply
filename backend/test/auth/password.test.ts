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
    const ok = await post(ctx, '/auth/password/change', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, a.accessToken);
    assert.equal(ok.status, 204);
    assert.equal((await get(ctx, '/me', a.accessToken)).status, 200);
    assert.equal((await get(ctx, '/me', b.body.accessToken)).status, 401);
    assert.equal((await loginAccount(ctx, { email: 'change@example.com', password: NEW_PASSWORD })).status, 200);
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
    const ok = await post(ctx, '/auth/password/reset', { email: 'reset@example.com', code, newPassword: NEW_PASSWORD });
    assert.equal(ok.status, 204);
    assert.equal((await get(ctx, '/me', a.accessToken)).status, 401);
    const again = await post<ErrorBody>(ctx, '/auth/password/reset', {
      email: 'reset@example.com',
      code,
      newPassword: 'Another2028',
    });
    assert.equal(again.status, 400);
    assert.equal(again.body.error.message, 'That code is incorrect or has expired.');
    assert.equal((await loginAccount(ctx, { email: 'reset@example.com', password: NEW_PASSWORD })).status, 200);
  });

  test('reset: a code expires after 15 minutes and allows 5 attempts', async () => {
    await registerAccount(ctx, { email: 'expire@example.com' });
    await post(ctx, '/auth/password/forgot', { email: 'expire@example.com' });
    const code = await latestResetCode('expire@example.com');
    for (let i = 0; i < 5; i += 1) {
      await post(ctx, '/auth/password/reset', { email: 'expire@example.com', code: '000000', newPassword: NEW_PASSWORD });
    }
    const locked = await post(ctx, '/auth/password/reset', { email: 'expire@example.com', code, newPassword: NEW_PASSWORD });
    assert.equal(locked.status, 400);

    await post(ctx, '/auth/password/forgot', { email: 'expire@example.com' });
    const fresh = await latestResetCode('expire@example.com');
    ctx.clock.advance(16 * 60_000);
    const late = await post(ctx, '/auth/password/reset', { email: 'expire@example.com', code: fresh, newPassword: NEW_PASSWORD });
    assert.equal(late.status, 400);
  });

  test('after 10 wrong codes in 24 h forgot issues no code (still 204) and admins are notified', async () => {
    const admin = await accountWithRole(ctx, 'ops@example.com', 'admin');
    const victim = await registerAccount(ctx, { email: 'victim@example.com' });
    for (let round = 0; round < 2; round += 1) {
      await post(ctx, '/auth/password/forgot', { email: 'victim@example.com' });
      await ctx.drainOutbox();
      for (let i = 0; i < 5; i += 1) {
        await post(ctx, '/auth/password/reset', { email: 'victim@example.com', code: '999999', newPassword: NEW_PASSWORD });
      }
    }
    const { rows: before } = await ctx.pool.query('SELECT count(*)::int AS n FROM dev_outbox WHERE to_address = $1', [
      'victim@example.com',
    ]);
    const forgot = await post(ctx, '/auth/password/forgot', { email: 'victim@example.com' });
    assert.equal(forgot.status, 204);
    await ctx.drainOutbox();
    const { rows: afterRows } = await ctx.pool.query('SELECT count(*)::int AS n FROM dev_outbox WHERE to_address = $1', [
      'victim@example.com',
    ]);
    assert.equal(afterRows[0]!.n, before[0]!.n);
    const { rows: alerts } = await ctx.pool.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM notifications WHERE user_id = $1 AND type = 'system'`,
      [admin.me.account.uid],
    );
    assert.ok(alerts.some((row) => row.dedupe_key.startsWith(`reset-locked-${victim.me.account.uid}-`)));
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
