import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { CALLABLES } from '@instasupply/shared';
import { routeTable } from '../../src/app';
import { registeredCommands } from '../../src/platform/http/command';
import { createTestContext, type TestContext } from './context';

/** §7.2: the complete list of public endpoints (method and path below /api/v1). */
const PUBLIC = new Set([
  'GET /health',
  'GET /config',
  'GET /live',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'POST /auth/invites/inspect',
  'POST /auth/password/setup',
  'GET /categories',
  'GET /stores',
  'GET /stores/:storeId',
  'GET /stores/:storeId/reviews',
  'GET /stores/:storeId/reviews/:storeOrderId',
  'GET /products',
  'GET /products/:productId',
  'GET /tracking/:token',
  'GET /media/*',
  'GET /files/local/:uploadId',
  'POST /files/local/:uploadId',
]);

describe('commands and routes (§5.1, §7)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  // Wave-2 teams replace placeholders while this suite runs, so only the set of names is fixed here,
  // never which of them are real yet.
  test('every name of CALLABLES is registered, as itself or as a placeholder, and nothing else', () => {
    const registered = registeredCommands();
    assert.deepEqual(
      registered.map((c) => c.name),
      Object.keys(CALLABLES).sort(),
    );
    for (const entry of registered) {
      if (entry.stubOwner !== null) assert.match(entry.stubOwner, /^[a-z-]+$/, entry.name);
    }
    const implemented = new Set(registered.filter((c) => c.stubOwner === null).map((c) => c.name));
    // The platform's own commands are real from the start.
    for (const name of [
      'createStaffUser',
      'inviteSupplierUser',
      'requestPhoneOtp',
      'runJobNow',
      'setSupplierUserStatus',
      'verifyPhoneOtp',
    ]) {
      assert.ok(implemented.has(name), `${name} is a placeholder`);
    }
  });

  test('every route has a policy, and the public ones are in the list of §7.2', () => {
    const routes = routeTable(ctx.app).filter((route) => route.method !== 'OPTIONS');
    assert.ok(routes.length > 20);
    for (const route of routes) {
      assert.ok(
        route.policy === 'public' || route.policy === 'guarded',
        `${route.method} ${route.url} has no policy`,
      );
      if (route.policy === 'public') {
        const key = `${route.method} ${route.url.replace(/^\/api\/v1/, '')}`;
        assert.ok(PUBLIC.has(key), `${key} is public but not in §7.2`);
      }
    }
  });
});
