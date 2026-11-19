/**
 * The in-process scheduler (docs/PLATFORM.md §9.5). A timer ticks every 15 s; a due job runs under a
 * PostgreSQL session advisory lock (statement (l)), so with several instances exactly one runs it and a
 * crashed instance releases the lock by itself.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { addLocalDays, fromLocal, localDateOf } from '@instasupply/shared';
import type pg from 'pg';
import type { Deps } from '../../container';
import { connect } from '../db/tx';
import { ApiError } from '../http/errors';
import {
  describeSchedule,
  jobFor,
  registeredJobs,
  type JobResult,
  type JobSchedule,
  type JobSpec,
} from './registry';

const TICK_MS = 15_000;
const LOCK_POLL_MS = 500;
const LOCK_WAIT_MS = 60_000;

const TRY_LOCK = `SELECT pg_try_advisory_lock(hashtextextended('instasupply:job:' || $1, 0)) AS locked`;
const UNLOCK = `SELECT pg_advisory_unlock(hashtextextended('instasupply:job:' || $1, 0))`;

/** The next run after `now`: now + interval, or the next HH:MM in Toronto (DST-aware, no Intl). */
export function nextRunAt(schedule: JobSchedule, now: number): number {
  if ('everyMs' in schedule) return now + schedule.everyMs;
  const minutes = schedule.dailyAt.hour * 60 + schedule.dailyAt.minute;
  const today = localDateOf(now);
  const candidate = fromLocal(today, minutes);
  return candidate > now ? candidate : fromLocal(addLocalDays(today, 1), minutes);
}

/** The first row of a job: due at once (interval) or at the next daily time. */
const firstRunAt = (schedule: JobSchedule, now: number): number =>
  'everyMs' in schedule ? now : nextRunAt(schedule, now);

export async function tryLock(client: pg.PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(TRY_LOCK, [name]);
  return rows[0]?.locked === true;
}

export async function unlock(client: pg.PoolClient, name: string): Promise<void> {
  await client.query(UNLOCK, [name]);
}

export class Scheduler {
  private deps: Deps | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private readonly running = new Set<Promise<unknown>>();

  bind(deps: Deps): void {
    this.deps = deps;
  }

  private get d(): Deps {
    if (!this.deps) throw new Error('Scheduler.bind(deps) was not called');
    return this.deps;
  }

  async start(): Promise<void> {
    await this.ensureRows();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async idle(ms: number): Promise<void> {
    const work = Promise.all([this.ticking, ...this.running]).then(() => undefined);
    await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())]);
  }

  /** Creates the missing scheduler_state rows; existing rows keep their next_run_at. */
  async ensureRows(now: number = this.d.clock.now()): Promise<void> {
    for (const job of registeredJobs()) {
      await this.d.pool.query(
        `INSERT INTO scheduler_state (job, next_run_at) VALUES ($1, $2) ON CONFLICT (job) DO NOTHING`,
        [job.name, new Date(firstRunAt(job.schedule, now))],
      );
    }
  }

  /** One tick: every due job that this instance can lock. Returns the names it ran. */
  tick(): Promise<string[]> {
    if (this.ticking) return this.ticking.then(() => []);
    const ran: string[] = [];
    const run = (async () => {
      const now = this.d.clock.now();
      const { rows } = await this.d.pool.query<{ job: string }>(
        'SELECT job FROM scheduler_state WHERE next_run_at <= $1 ORDER BY job',
        [new Date(now)],
      );
      for (const { job: name } of rows) {
        const job = jobFor(name);
        if (!job) continue;
        if (await this.runIfDue(job)) ran.push(name);
      }
    })()
      .catch((error: unknown) => this.d.log.error({ err: error }, 'scheduler tick failed'))
      .finally(() => {
        this.ticking = null;
      });
    this.ticking = run;
    return run.then(() => ran);
  }

  private async runIfDue(job: JobSpec): Promise<boolean> {
    const client = await connect(this.d.pool);
    try {
      if (!(await tryLock(client, job.name))) return false;
      try {
        // Another instance may have just finished it: read next_run_at again under the lock.
        const now = this.d.clock.now();
        const { rows } = await client.query<{ next_run_at: number }>(
          'SELECT next_run_at FROM scheduler_state WHERE job = $1',
          [job.name],
        );
        const due = rows[0];
        if (!due || due.next_run_at > now) return false;
        // A failing job is recorded and logged by execute(); the other due jobs still run.
        const work = this.execute(job, now, { moveNext: true }).catch(() => null);
        this.running.add(work);
        try {
          await work;
        } finally {
          this.running.delete(work);
        }
        return true;
      } finally {
        await unlock(client, job.name);
      }
    } finally {
      client.release();
    }
  }

  /** Runs the body and records the run in scheduler_state. Never throws for a failing job. */
  private async execute(job: JobSpec, now: number, opts: { moveNext: boolean }): Promise<JobResult | null> {
    const started = Date.now();
    await this.d.pool.query(
      `INSERT INTO scheduler_state (job, next_run_at, last_started_at) VALUES ($1, $2, $3)
       ON CONFLICT (job) DO UPDATE SET last_started_at = EXCLUDED.last_started_at`,
      [job.name, new Date(firstRunAt(job.schedule, now)), new Date(now)],
    );
    let result: JobResult | null = null;
    let error: unknown = null;
    try {
      result = await job.run(this.d, now);
    } catch (caught) {
      error = caught;
    }
    const finished = this.d.clock.now();
    const next = opts.moveNext ? nextRunAt(job.schedule, finished) : null;
    await this.d.pool.query(
      `UPDATE scheduler_state SET last_finished_at = $2, last_status = $3, last_error = $4, last_result = $5::jsonb,
              next_run_at = COALESCE($6, next_run_at)
        WHERE job = $1`,
      [
        job.name,
        new Date(finished),
        error ? 'error' : 'ok',
        error ? (error instanceof Error ? error.message : String(error)).slice(0, 500) : null,
        result ? JSON.stringify(result) : null,
        next === null ? null : new Date(next),
      ],
    );
    const line = { job: job.name, durationMs: Date.now() - started, outcome: error ? 'error' : 'ok', result };
    if (error) this.d.log.error({ ...line, err: error }, 'scheduled job failed');
    else this.d.log.info(line, 'scheduled job finished');
    if (error) throw error;
    return result;
  }

  /**
   * runJobNow (§9.5): waits for the job's lock by polling (a blocking pg_advisory_lock would be cancelled by
   * the pool's statement_timeout), runs the body with `now`, records the run without moving next_run_at.
   */
  async runJob(name: string, now: number): Promise<JobResult> {
    const job = jobFor(name);
    if (!job) throw new ApiError('not-found', `There is no job called ${name}.`);
    const client = await connect(this.d.pool);
    try {
      const deadline = Date.now() + LOCK_WAIT_MS;
      while (!(await tryLock(client, job.name))) {
        if (Date.now() >= deadline) {
          throw new ApiError('unavailable', 'That job is running right now. Try again in a moment.', null, {
            retryAfterMs: 5000,
          });
        }
        await sleep(LOCK_POLL_MS);
      }
      try {
        return (await this.execute(job, now, { moveNext: false })) ?? {};
      } finally {
        await unlock(client, job.name);
      }
    } finally {
      client.release();
    }
  }

  /** The rows behind GET /ops/jobs. */
  static describe(name: string): string {
    const job = jobFor(name);
    return job ? describeSchedule(job.schedule) : 'unknown';
  }
}
