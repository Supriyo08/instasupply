import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { registeredCommands, stubCommandSpec } from '../../src/platform/http/command';
import type { RequestContext } from '../../src/platform/http/context';
import { ApiError, HTTP_STATUS } from '../../src/platform/http/errors';
import {
  call,
  command,
  createTestContext,
  post,
  registerAccount,
  type ErrorBody,
  type TestContext,
} from './context';

describe('error envelope (§4.2) and request ids (§4.3)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('the HTTP status of every ApiStatus', () => {
    assert.deepEqual(HTTP_STATUS, {
      'invalid-argument': 400,
      unauthenticated: 401,
      'permission-denied': 403,
      'not-found': 404,
      'already-exists': 409,
      'failed-precondition': 412,
      'resource-exhausted': 429,
      internal: 500,
      unavailable: 503,
    });
    assert.equal(new ApiError('unavailable', 'x').httpStatus, 503);
  });

  test('an unknown route and an unknown command are not-found envelopes', async () => {
    const route = await call<ErrorBody>(ctx, { method: 'GET', url: '/api/v1/nope' });
    assert.equal(route.status, 404);
    assert.deepEqual(Object.keys(route.body.error).sort(), ['code', 'details', 'message', 'status']);
    const cmd = await command<ErrorBody>(ctx, 'doesNotExist', {});
    assert.equal(cmd.status, 404);
    assert.equal(cmd.body.error.status, 'not-found');
  });

  test('zod failures list their fields', async () => {
    const answer = await post<ErrorBody>(ctx, '/auth/login', { email: 'not-an-email', installationId: 'x' });
    assert.equal(answer.status, 400);
    const fields = answer.body.error.details.fields as Record<string, string>;
    assert.ok(fields.email && fields.password && fields.installationId && fields.app);
  });

  test('415 for a wrong content type, 400 for broken JSON, 413 for a big body', async () => {
    const wrongType = await call<ErrorBody>(ctx, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: 'hello',
      headers: { 'content-type': 'text/plain' },
    });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.body.error.status, 'invalid-argument');
    const broken = await call<ErrorBody>(ctx, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: '{"email":',
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(broken.status, 400);
    const big = await call<ErrorBody>(ctx, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: JSON.stringify({ email: 'a'.repeat(300 * 1024) }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(big.status, 413);
    assert.equal(big.body.error.status, 'invalid-argument');
  });

  test('placeholder commands need a token and answer internal "not implemented" without naming the owner', async () => {
    // A test-only placeholder: the wave-2 names stop being placeholders as their modules land.
    const spec = stubCommandSpec('testOnlyPlaceholder');
    const anonymous = { actor: null, authFailure: null } as unknown as RequestContext;
    assert.throws(
      () => spec.policy(anonymous),
      (error: unknown) => error instanceof ApiError && error.status === 'unauthenticated',
    );
    await assert.rejects(
      spec.handler(anonymous, {}, null),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 'internal' &&
        error.message === 'not implemented' &&
        JSON.stringify(error.details) === '{"command":"testOnlyPlaceholder"}',
    );
    // Through HTTP, whenever a placeholder is still registered.
    const placeholder = registeredCommands().find((c) => c.stubOwner !== null);
    if (placeholder) {
      const none = await command<ErrorBody>(ctx, placeholder.name, {}, undefined);
      assert.equal(none.status, 401);
      const session = await registerAccount(ctx, { email: 'stub@example.com' });
      const stub = await command<ErrorBody>(ctx, placeholder.name, {}, session.accessToken);
      assert.equal(stub.status, 500);
      assert.equal(stub.body.error.status, 'internal');
      assert.equal(stub.body.error.message, 'not implemented');
      assert.equal(JSON.stringify(stub.body.error).includes('owner'), false);
    }
  });

  test('X-Request-Id is echoed when valid and generated otherwise; every response has it', async () => {
    const mine = await call(ctx, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'req_12345678' },
    });
    assert.equal(mine.headers['x-request-id'], 'req_12345678');
    const bad = await call(ctx, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'bad id!' },
    });
    assert.match(String(bad.headers['x-request-id']), /^[0-9a-f-]{36}$/);
    const failed = await call(ctx, { method: 'GET', url: '/api/v1/me' });
    assert.ok(failed.headers['x-request-id']);
    assert.equal(failed.headers['cache-control'], 'no-store');
  });

  test('security headers are on every response', async () => {
    const answer = await call(ctx, { method: 'GET', url: '/api/v1/config' });
    assert.equal(answer.headers['x-content-type-options'], 'nosniff');
    assert.equal(answer.headers['referrer-policy'], 'no-referrer');
    assert.equal(answer.headers['x-frame-options'], 'DENY');
    assert.equal(answer.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.match(String(answer.headers['content-security-policy']), /default-src 'none'/);
    assert.equal(answer.headers['strict-transport-security'], undefined);
  });

  test('CORS: listed and local origins are allowed, others are not; no credentials', async () => {
    const local = await call(ctx, {
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://192.168.1.20:8081', 'access-control-request-method': 'POST' },
    });
    assert.equal(local.headers['access-control-allow-origin'], 'http://192.168.1.20:8081');
    assert.equal(local.headers['access-control-allow-credentials'], undefined);
    const foreign = await call(ctx, {
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);
  });
});
