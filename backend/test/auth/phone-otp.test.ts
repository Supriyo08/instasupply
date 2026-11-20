import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  command,
  createTestContext,
  registerAccount,
  type ErrorBody,
  type TestContext,
} from '../platform/context';

interface OtpAnswer {
  phoneNumber: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  devCode?: string;
}

describe('phone verification (§6.3.9)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('an account without a role must finish its profile first', async () => {
    const session = await registerAccount(ctx, { email: 'norole@example.com' });
    const answer = await command<ErrorBody>(
      ctx,
      'requestPhoneOtp',
      { phoneNumber: '416 555 0123' },
      session.accessToken,
    );
    assert.equal(answer.status, 412);
  });

  test('Canadian area codes only: +1 876 and +1 268 are refused', async () => {
    const session = await accountWithRole(ctx, 'jm@example.com', 'customer');
    for (const phone of ['+1 876 555 0123', '+1 268 555 0123']) {
      const answer = await command<ErrorBody>(
        ctx,
        'requestPhoneOtp',
        { phoneNumber: phone },
        session.accessToken,
      );
      assert.equal(answer.status, 400);
      assert.equal(answer.body.error.message, 'Use a Canadian mobile number.');
    }
  });

  test('request, wrong code counts and survives, right code verifies; dev code returned', async () => {
    const session = await accountWithRole(ctx, 'dana@example.com', 'customer');
    const sent = await command<OtpAnswer>(
      ctx,
      'requestPhoneOtp',
      { phoneNumber: '(416) 555-0123' },
      session.accessToken,
    );
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.phoneNumber, '+14165550123');
    assert.equal(sent.body.expiresInSeconds, 300);
    assert.match(sent.body.devCode ?? '', /^\d{6}$/);
    const wrongCode = sent.body.devCode === '000000' ? '111111' : '000000';
    const wrong = await command<ErrorBody>(ctx, 'verifyPhoneOtp', { code: wrongCode }, session.accessToken);
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error.message, /4 attempts left/);
    const { rows } = await ctx.pool.query<{ attempts: number }>(
      'SELECT attempts FROM otp_challenges WHERE user_id = $1',
      [session.me.account.uid],
    );
    assert.equal(rows[0]!.attempts, 1);
    const ok = await command<{ phoneNumber: string }>(
      ctx,
      'verifyPhoneOtp',
      { code: sent.body.devCode },
      session.accessToken,
    );
    assert.equal(ok.status, 200);
    const { rows: users } = await ctx.pool.query(
      'SELECT phone_number, phone_verified FROM users WHERE id = $1',
      [session.me.account.uid],
    );
    assert.deepEqual(users[0], { phone_number: '+14165550123', phone_verified: true });
    // The SMS was enqueued as a sensitive event and stored in the dev outbox.
    await ctx.drainOutbox();
    const { rows: sms } = await ctx.pool.query(
      `SELECT sensitive FROM dev_outbox WHERE to_address = '+14165550123'`,
    );
    assert.deepEqual(sms, [{ sensitive: true }]);
  });

  test('cooldown of 30 s and at most 5 sends per hour', async () => {
    const session = await accountWithRole(ctx, 'cool@example.com', 'customer');
    const ask = () =>
      command<ErrorBody>(ctx, 'requestPhoneOtp', { phoneNumber: '647 555 0111' }, session.accessToken);
    assert.equal((await ask()).status, 200);
    const tooSoon = await ask();
    assert.equal(tooSoon.status, 429);
    assert.equal(tooSoon.body.error.code, 'RATE_LIMITED');
    for (let i = 0; i < 4; i += 1) {
      ctx.clock.advance(31_000);
      assert.equal((await ask()).status, 200);
    }
    ctx.clock.advance(31_000);
    assert.equal((await ask()).status, 429);
  });

  test('test numbers verify with their fixed code and send no SMS', async () => {
    const session = await accountWithRole(ctx, 'testnum@example.com', 'driver');
    await command(ctx, 'requestPhoneOtp', { phoneNumber: '+14165550199' }, session.accessToken);
    const ok = await command(ctx, 'verifyPhoneOtp', { code: '123456' }, session.accessToken);
    assert.equal(ok.status, 200);
    await ctx.drainOutbox();
    const { rows } = await ctx.pool.query(`SELECT 1 FROM dev_outbox WHERE to_address = '+14165550199'`);
    assert.equal(rows.length, 0);
  });

  test("another account's number is only revealed after a correct code", async () => {
    const other = await accountWithRole(ctx, 'other@example.com', 'customer');
    const request = await command<OtpAnswer>(
      ctx,
      'requestPhoneOtp',
      { phoneNumber: '416 555 0123' },
      other.accessToken,
    );
    assert.equal(request.status, 200);
    const taken = await command<ErrorBody>(
      ctx,
      'verifyPhoneOtp',
      { code: request.body.devCode },
      other.accessToken,
    );
    assert.equal(taken.status, 409);
  });

  test('an expired code is failed-precondition', async () => {
    const session = await accountWithRole(ctx, 'exp@example.com', 'customer');
    const sent = await command<OtpAnswer>(
      ctx,
      'requestPhoneOtp',
      { phoneNumber: '905 555 0144' },
      session.accessToken,
    );
    ctx.clock.advance(5 * 60_000 + 1);
    const late = await command<ErrorBody>(
      ctx,
      'verifyPhoneOtp',
      { code: sent.body.devCode },
      session.accessToken,
    );
    assert.equal(late.status, 412);
  });
});

describe('phone verification modes and global caps', () => {
  test('PHONE_VERIFICATION=off refuses; outbox SMS without dev codes refuses real numbers', async () => {
    const off = await createTestContext({ env: { PHONE_VERIFICATION: 'off' } });
    try {
      const session = await accountWithRole(off, 'off@example.com', 'customer');
      const answer = await command<ErrorBody>(
        off,
        'requestPhoneOtp',
        { phoneNumber: '416 555 0123' },
        session.accessToken,
      );
      assert.equal(answer.body.error.message, 'Phone verification is switched off.');
    } finally {
      await off.close();
    }
    const noSms = await createTestContext({ env: { EXPOSE_DEV_CODES: 'false' } });
    try {
      const session = await accountWithRole(noSms, 'nosms@example.com', 'customer');
      const answer = await command<ErrorBody>(
        noSms,
        'requestPhoneOtp',
        { phoneNumber: '416 555 0123' },
        session.accessToken,
      );
      assert.equal(answer.body.error.message, "Phone verification by SMS isn't available yet.");
      const test = await command(
        noSms,
        'requestPhoneOtp',
        { phoneNumber: '+16475550199' },
        session.accessToken,
      );
      assert.equal(test.status, 200);
    } finally {
      await noSms.close();
    }
  });

  test('the global hourly cap refuses and alerts admins', async () => {
    const ctx = await createTestContext({ env: { RATE_LIMITS_DISABLED: 'false' } });
    try {
      const session = await accountWithRole(ctx, 'limits@example.com', 'customer');
      const admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
      // The hourly global bucket is full: the next request is refused and admins are told once.
      await ctx.pool.query(
        `INSERT INTO rate_limits (bucket, subject, count, window_start, expires_at) VALUES ('otp_global', 'global', 200, $1, $2)`,
        [new Date(ctx.clock.now()), new Date(ctx.clock.now() + 3_600_000)],
      );
      const capped = await command<ErrorBody>(
        ctx,
        'requestPhoneOtp',
        { phoneNumber: '416 555 0177' },
        session.accessToken,
      );
      assert.equal(capped.status, 429);
      const { rows } = await ctx.pool.query(`SELECT dedupe_key FROM notifications WHERE user_id = $1`, [
        admin.me.account.uid,
      ]);
      assert.equal(rows.length, 1);
      assert.match(String(rows[0]!.dedupe_key), /^otp-global-/);
    } finally {
      await ctx.close();
    }
  });
});
