import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../../src/config/env';
import { loggerOptions, prettyAvailable } from '../../src/platform/logger';
import { call, createTestContext, loginAccount, registerAccount, type TestContext } from './context';

describe('logging (§4.3)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('one completion line per request, with no URL, query, address, token or email', async () => {
    const session = await registerAccount(ctx, { email: 'secret.person@example.com' });
    await loginAccount(ctx, { email: 'secret.person@example.com' });
    ctx.logs.length = 0;
    await call(ctx, {
      method: 'GET',
      url: '/api/v1/me?probe=query-string-value',
      token: session.accessToken,
    });
    const lines = ctx.logs;
    const completions = lines.filter((line) => line.message === 'request completed');
    assert.equal(completions.length, 1);
    const line = completions[0]!;
    assert.equal(line.route, '/api/v1/me');
    assert.equal(line.statusCode, 200);
    assert.equal(line.uid, session.me.account.uid);
    assert.equal(typeof line.level, 'string');
    assert.match(String(line.ip), /^[0-9a-f]{16}$/);
    const text = JSON.stringify(lines);
    for (const forbidden of [
      'query-string-value',
      '127.0.0.1',
      'remoteAddress',
      session.accessToken,
      'secret.person',
      '"url"',
    ]) {
      assert.ok(!text.includes(forbidden), `log contains ${forbidden}`);
    }
  });

  test('LOG_PRETTY falls back to JSON when pino-pretty is not installed (the production image)', () => {
    const missing = () => {
      throw new Error('Cannot find package pino-pretty');
    };
    assert.equal(prettyAvailable(missing), false);
    assert.equal(prettyAvailable(), true);
    const config = loadConfig({ NODE_ENV: 'development', LOG_PRETTY: 'true' });
    assert.equal(loggerOptions(config, false).transport, undefined);
    assert.ok(loggerOptions(config).transport);
  });
});
