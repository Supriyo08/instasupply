import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { withTransaction } from '../../src/platform/db/tx';
import { enqueue } from '../../src/platform/outbox/outbox';
import { registerHandler } from '../../src/platform/outbox/registry';
import { backoffMs, OutboxWorker } from '../../src/platform/outbox/worker';
import { accountWithRole, createTestContext, type TestContext } from './context';

describe('the transactional outbox (§9.3)', () => {
  let ctx: TestContext;
  const handled: { id: string; attempt: number }[] = [];
  let failUntil = 0;
  before(async () => {
    ctx = await createTestContext();
    // tracking.eta is a wave-2 event; the test owns its handler for the duration of this file.
    registerHandler<{ id: string }>('tracking.eta', async (payload, { attempt }) => {
      handled.push({ id: payload.id, attempt });
      if (attempt <= failUntil) throw new Error(`failing attempt ${attempt}`);
    });
  });
  beforeEach(async () => {
    handled.length = 0;
    failUntil = 0;
    await ctx.pool.query('DELETE FROM outbox');
  });
  after(() => ctx.close());

  const put = (payload: object, opts: Parameters<typeof enqueue>[3] = {}) =>
    withTransaction(ctx.deps, (tx) => enqueue(tx, 'tracking.eta', payload, opts));

  test('an enqueue is rolled back with its transaction', async () => {
    await assert.rejects(
      withTransaction(ctx.deps, async (tx) => {
        await enqueue(tx, 'tracking.eta', { id: 'gone' });
        throw new Error('abort');
      }),
    );
    const { rows } = await ctx.pool.query('SELECT 1 FROM outbox');
    assert.equal(rows.length, 0);
  });

  test('rows coalesce on the dedupe key while pending, and drain() runs them', async () => {
    await put({ id: 'a' }, { dedupeKey: 'k1' });
    await put({ id: 'b' }, { dedupeKey: 'k1' });
    await put({ id: 'c' });
    assert.equal(await ctx.drainOutbox(), 2);
    assert.deepEqual(handled.map((h) => h.id).sort(), ['a', 'c']);
  });

  test('backoff schedule: 5 s × 2^(n − 1), at most 15 min, ±20 %', () => {
    assert.equal(
      backoffMs(1, () => 0.5),
      5000,
    );
    assert.equal(
      backoffMs(3, () => 0.5),
      20_000,
    );
    assert.equal(
      backoffMs(20, () => 0.5),
      15 * 60_000,
    );
    assert.equal(
      backoffMs(1, () => 0),
      4000,
    );
    assert.equal(
      backoffMs(1, () => 1),
      6000,
    );
  });

  test('a failure goes back to pending with backoff; dead after max_attempts with an admin alert', async () => {
    const admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
    failUntil = 99;
    await put({ id: 'f' });
    await ctx.drainOutbox();
    let { rows } = await ctx.pool.query<{ status: string; attempts: number; run_at: number }>(
      'SELECT status, attempts, run_at FROM outbox',
    );
    assert.equal(rows[0]!.status, 'pending');
    assert.equal(rows[0]!.attempts, 1);
    assert.ok(rows[0]!.run_at > ctx.clock.now());
    ctx.clock.advance(60_000);
    await ctx.drainOutbox();
    ({ rows } = await ctx.pool.query('SELECT status, attempts, run_at FROM outbox'));
    assert.equal(rows[0]!.status, 'dead');
    const alerts = await ctx.pool.query(`SELECT dedupe_key FROM notifications WHERE user_id = $1`, [
      admin.me.account.uid,
    ]);
    assert.equal(alerts.rows.length, 1);
    assert.match(String(alerts.rows[0]!.dedupe_key), /^outbox-dead-\d+$/);
  });

  test('statement (m): a failed row with a newer pending duplicate is finished as done (no 23505)', async () => {
    await put({ id: 'first' }, { dedupeKey: 'route:1' });
    const worker = new OutboxWorker();
    worker.bind(ctx.deps);
    const claimed = await worker.claim(10);
    assert.equal(claimed.length, 1);
    await put({ id: 'second' }, { dedupeKey: 'route:1' });
    // The claimed row is stuck (its instance died): the reaper gives it back, one row per statement.
    ctx.clock.advance(6 * 60_000);
    assert.equal(await worker.reap(), 1);
    const { rows } = await ctx.pool.query<{ status: string; payload: { id: string } }>(
      'SELECT status, payload FROM outbox ORDER BY id',
    );
    assert.deepEqual(
      rows.map((r) => [r.payload.id, r.status]),
      [
        ['first', 'done'],
        ['second', 'pending'],
      ],
    );
    await ctx.drainOutbox();
    assert.deepEqual(
      handled.map((h) => h.id),
      ['second'],
    );
  });

  test('the reaper returns every stuck row to pending', async () => {
    await put({ id: 'r1' });
    await put({ id: 'r2' });
    const worker = new OutboxWorker();
    worker.bind(ctx.deps);
    await worker.claim(10);
    ctx.clock.advance(6 * 60_000);
    assert.equal(await worker.reap(), 2);
    const { rows } = await ctx.pool.query<{ status: string }>('SELECT status FROM outbox');
    assert.deepEqual(
      rows.map((r) => r.status),
      ['pending', 'pending'],
    );
  });

  test('two workers claiming at once never take the same row', async () => {
    for (let i = 0; i < 30; i += 1) await put({ id: `w${i}` });
    const a = new OutboxWorker();
    const b = new OutboxWorker();
    a.bind(ctx.deps);
    b.bind(ctx.deps);
    const [x, y] = await Promise.all([a.claim(20), b.claim(20)]);
    const ids = [...x, ...y].map((row) => row.id);
    assert.equal(ids.length, 30);
    assert.equal(new Set(ids).size, 30);
  });
});
