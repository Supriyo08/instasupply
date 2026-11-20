import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app';
import { createDeps } from '../../src/container';
import { createTestContext, get, type TestContext } from './context';

describe('GET /api/v1/health (§5.3.1)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
  });
  after(() => ctx.close());

  test('200 with the database', async () => {
    const answer = await get<{ status: string; serverTime: number; version: string }>(ctx, '/health');
    assert.equal(answer.status, 200);
    assert.equal(answer.body.status, 'ok');
    assert.equal(answer.body.serverTime, ctx.clock.now());
  });

  test('503 unavailable when the database does not answer', async () => {
    const dead = new pg.Pool({
      connectionString: 'postgres://localhost:1/none',
      connectionTimeoutMillis: 500,
    });
    dead.on('error', () => {});
    const deps = createDeps(ctx.config, { pool: dead, log: ctx.deps.log, clock: ctx.clock });
    const app = await buildApp(deps);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      assert.equal(response.statusCode, 503);
      assert.equal(JSON.parse(response.body).error.status, 'unavailable');
      assert.equal(response.headers['retry-after'], '1');
    } finally {
      await app.close();
      await dead.end();
    }
  });
});
