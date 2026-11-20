import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiError } from '../../src/platform/http/errors';
import { clientAddress } from '../../src/platform/http/client-address';
import { consumeRateLimit } from '../../src/platform/http/rate-limit';
import { createTestContext, PASSWORD, type TestContext } from './context';

describe('rate limits (§4.6)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext({ env: { RATE_LIMITS_DISABLED: 'false', TRUST_PROXY: 'true' } });
  });
  after(() => ctx.close());

  test('fixed windows: max per window, RATE_LIMITED with retryAfterMs, a fresh window after expiry', async () => {
    const hit = () => consumeRateLimit(ctx.deps, 'probe', 'subject-a', 3, 60);
    await hit();
    await hit();
    await hit();
    await assert.rejects(hit(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.details.retryAfterMs, 60_000);
      return true;
    });
    ctx.clock.advance(30_000);
    await assert.rejects(
      hit(),
      (error) => error instanceof ApiError && error.details.retryAfterMs === 30_000,
    );
    ctx.clock.advance(30_000);
    await hit();
  });

  test('subjects are HMACs: no raw address or email in rate_limits', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-real-ip': '198.51.100.23' },
      payload: {
        email: 'someone@example.com',
        password: PASSWORD,
        installationId: 'probe-install',
        app: 'customer',
      },
    });
    const { rows } = await ctx.pool.query<{ bucket: string; subject: string }>(
      'SELECT bucket, subject FROM rate_limits',
    );
    assert.ok(rows.some((row) => row.bucket === 'login_ip'));
    for (const row of rows.filter((r) => r.bucket !== 'probe')) {
      assert.match(row.subject, /^[0-9a-f]{64}$/);
      assert.ok(!row.subject.includes('198.51.100.23') && !row.subject.includes('someone'));
    }
  });

  test('a forged X-Forwarded-For with a fixed X-Real-IP lands in the same bucket', async () => {
    const login = (forwarded: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-real-ip': '203.0.113.50', 'x-forwarded-for': forwarded },
        payload: {
          email: 'x@example.com',
          password: PASSWORD,
          installationId: 'probe-install',
          app: 'customer',
        },
      });
    for (let i = 0; i < 30; i += 1) await login(`10.0.0.${i}`);
    const blocked = await login('10.9.9.9');
    assert.equal(blocked.statusCode, 429);
  });

  test('with TRUST_PROXY=false X-Real-IP is ignored', () => {
    const req = { headers: { 'x-real-ip': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(clientAddress(req, { TRUST_PROXY: false }), '127.0.0.1');
    assert.equal(clientAddress(req, { TRUST_PROXY: true }), '1.2.3.4');
  });

  test('RATE_LIMITS_DISABLED switches the database layer off', async () => {
    const off = { ...ctx.deps, config: { ...ctx.deps.config, RATE_LIMITS_DISABLED: true } };
    for (let i = 0; i < 5; i += 1) await consumeRateLimit(off, 'probe-off', 's', 1, 60);
  });
});
