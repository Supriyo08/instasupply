import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { registerJob } from '../../src/platform/scheduler/registry';
import { nextRunAt, Scheduler } from '../../src/platform/scheduler/scheduler';
import { accountWithRole, command, createTestContext, type ErrorBody, type TestContext } from './context';

describe('scheduler (§9.5)', () => {
  test('the daily 21:00 Toronto job across both DST changes', () => {
    const daily = { dailyAt: { hour: 21, minute: 0 } };
    // Before 21:00 EST on 2026-11-19 → the same day at 02:00Z next day.
    assert.equal(
      new Date(nextRunAt(daily, Date.UTC(2026, 10, 19, 17, 25))).toISOString(),
      '2026-11-20T02:00:00.000Z',
    );
    // After it → the next day.
    assert.equal(
      new Date(nextRunAt(daily, Date.UTC(2026, 10, 20, 2, 0))).toISOString(),
      '2026-11-21T02:00:00.000Z',
    );
    // Spring forward (2026-03-08): 21:00 EDT is 01:00Z.
    assert.equal(
      new Date(nextRunAt(daily, Date.UTC(2026, 2, 8, 12, 0))).toISOString(),
      '2026-03-09T01:00:00.000Z',
    );
    // Fall back (2026-11-01): 21:00 EST is 02:00Z.
    assert.equal(
      new Date(nextRunAt(daily, Date.UTC(2026, 10, 1, 12, 0))).toISOString(),
      '2026-11-02T02:00:00.000Z',
    );
    assert.equal(nextRunAt({ everyMs: 300_000 }, 1000), 301_000);
  });

  describe('runs', () => {
    let ctx: TestContext;
    let runs = 0;
    let fail = false;
    before(async () => {
      ctx = await createTestContext();
      // Borrows a ScheduledJobName (runJobNow accepts no other). Registered after buildApp, so this body
      // replaces the real one its module registered, whichever modules have landed.
      registerJob({
        name: 'expireQuotes',
        schedule: { everyMs: 15 * 60_000 },
        run: async () => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (fail) throw new Error('boom');
          return { expired: 0 };
        },
      });
    });
    after(() => ctx.close());

    test('a due job runs once across two schedulers', async () => {
      const a = new Scheduler();
      const b = new Scheduler();
      a.bind(ctx.deps);
      b.bind(ctx.deps);
      await a.ensureRows();
      const [ranA, ranB] = await Promise.all([a.tick(), b.tick()]);
      assert.equal([...ranA, ...ranB].filter((name) => name === 'expireQuotes').length, 1);
      assert.equal(runs, 1);
      const { rows } = await ctx.pool.query<{ next_run_at: number; last_status: string }>(
        `SELECT next_run_at, last_status FROM scheduler_state WHERE job = 'expireQuotes'`,
      );
      assert.equal(rows[0]!.last_status, 'ok');
      assert.equal(rows[0]!.next_run_at, ctx.clock.now() + 15 * 60_000);
      // Not due any more.
      assert.deepEqual(
        (await a.tick()).filter((name) => name === 'expireQuotes'),
        [],
      );
    });

    test('a failing job records error and runs again when due', async () => {
      const s = new Scheduler();
      s.bind(ctx.deps);
      fail = true;
      ctx.clock.advance(16 * 60_000);
      await s.tick();
      let { rows } = await ctx.pool.query<{ last_status: string; last_error: string }>(
        `SELECT last_status, last_error FROM scheduler_state WHERE job = 'expireQuotes'`,
      );
      assert.deepEqual(rows[0], { last_status: 'error', last_error: 'boom' });
      fail = false;
      ctx.clock.advance(16 * 60_000);
      await s.tick();
      ({ rows } = await ctx.pool.query(
        `SELECT last_status, last_error FROM scheduler_state WHERE job = 'expireQuotes'`,
      ));
      assert.deepEqual(rows[0], { last_status: 'ok', last_error: null });
    });

    test('runJobNow: admins only, with its own now, without moving next_run_at', async () => {
      const admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
      const dispatcher = await accountWithRole(ctx, 'disp@example.com', 'dispatcher');
      const before = await ctx.pool.query<{ next_run_at: number }>(
        `SELECT next_run_at FROM scheduler_state WHERE job = 'expireQuotes'`,
      );
      const denied = await command<ErrorBody>(
        ctx,
        'runJobNow',
        { job: 'expireQuotes' },
        dispatcher.accessToken,
      );
      assert.equal(denied.status, 403);
      const ok = await command<{ job: string; now: number; result: Record<string, number> }>(
        ctx,
        'runJobNow',
        { job: 'expireQuotes', now: 1795200000000 },
        admin.accessToken,
      );
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.deepEqual(ok.body, { job: 'expireQuotes', now: 1795200000000, result: { expired: 0 } });
      const afterRun = await ctx.pool.query<{ next_run_at: number }>(
        `SELECT next_run_at FROM scheduler_state WHERE job = 'expireQuotes'`,
      );
      assert.equal(afterRun.rows[0]!.next_run_at, before.rows[0]!.next_run_at);
      const internal = await command<ErrorBody>(
        ctx,
        'runJobNow',
        { job: 'purgeExpiredRows' },
        admin.accessToken,
      );
      assert.equal(internal.status, 400);
    });
  });

  test('runJobNow is refused without ALLOW_TEST_JOBS', async () => {
    const ctx = await createTestContext({ env: { ALLOW_TEST_JOBS: 'false' } });
    try {
      const admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
      const answer = await command<ErrorBody>(ctx, 'runJobNow', { job: 'expireQuotes' }, admin.accessToken);
      assert.equal(answer.status, 403);
    } finally {
      await ctx.close();
    }
  });
});
