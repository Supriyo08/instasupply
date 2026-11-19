/**
 * The outbox worker (docs/PLATFORM.md §9.3): claim due rows in a short transaction (statement (f), SKIP
 * LOCKED so instances never wait for each other), run the handlers outside any transaction, then finish
 * the row or give it back with statement (m). Delivery is at least once; handlers are idempotent.
 */
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Deps } from '../../container';
import { notifyStaff } from '../../modules/notifications/notify';
import { withTransaction } from '../db/tx';
import { handlerFor } from './registry';

const REAP_EVERY_MS = 60_000;
const STUCK_AFTER_MS = 5 * 60_000;
const ERROR_CHARS = 500;

interface Claimed {
  id: number;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** min(15 min, 5 s × 2^(attempts − 1)) with ±20 % jitter. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Statement (m) of §3.5: give a claimed row back, or finish it as done when a newer pending row exists. */
export const RELEASE_SQL = `UPDATE outbox o SET
  status      = CASE WHEN o.dedupe_key IS NOT NULL AND EXISTS (
                       SELECT 1 FROM outbox p WHERE p.dedupe_key = o.dedupe_key AND p.status = 'pending' AND p.id <> o.id)
                     THEN 'done' ELSE $2 END,
  run_at      = $3, locked_at = NULL, locked_by = NULL, last_error = $4,
  finished_at = CASE WHEN $2 = 'dead' THEN $5 ELSE NULL END
WHERE o.id = $1 AND o.status IN ('processing', 'dead')
RETURNING status`;

export class OutboxWorker {
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private deps: Deps | null = null;
  private timer: NodeJS.Timeout | null = null;
  private reaper: NodeJS.Timeout | null = null;
  private loop: Promise<void> | null = null;
  private wakeRequested = false;
  private stopped = true;
  private readonly inFlight = new Set<Promise<void>>();

  bind(deps: Deps): void {
    this.deps = deps;
  }

  private get d(): Deps {
    if (!this.deps) throw new Error('OutboxWorker.bind(deps) was not called');
    return this.deps;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => this.wake(), this.d.config.OUTBOX_POLL_MS);
    this.timer.unref();
    this.reaper = setInterval(() => {
      this.reap().catch((error: unknown) => this.d.log.error({ err: error }, 'outbox reaper failed'));
    }, REAP_EVERY_MS);
    this.reaper.unref();
    this.wake();
  }

  /** No new claims; running handlers continue (`idle()` waits for them). */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reaper) clearInterval(this.reaper);
    this.timer = null;
    this.reaper = null;
  }

  /** An `is_outbox` notification or the poll timer. */
  wake(): void {
    if (this.stopped) return;
    if (this.loop) {
      this.wakeRequested = true;
      return;
    }
    this.loop = (async () => {
      try {
        do {
          this.wakeRequested = false;
          while (!this.stopped && (await this.runBatch()) > 0) {
            // keep going while there is due work
          }
        } while (this.wakeRequested && !this.stopped);
      } catch (error) {
        this.d.log.error({ err: error }, 'outbox loop failed');
      } finally {
        this.loop = null;
      }
    })();
  }

  /** Waits for the running loop and handlers, at most `ms`. */
  async idle(ms: number): Promise<void> {
    const work = Promise.all([this.loop, ...this.inFlight]).then(() => undefined);
    await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())]);
  }

  /** Repeats claim-and-run until no due row is left. Tests, the seed and runJobNow call it. Returns the count. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const handled = await this.runBatch();
      if (handled === 0) return total;
      total += handled;
    }
  }

  /** Statement (f): one short transaction that marks up to OUTBOX_BATCH due rows `processing`. */
  async claim(limit: number = this.d.config.OUTBOX_BATCH): Promise<Claimed[]> {
    const now = this.d.clock.now();
    const { rows } = await this.d.pool.query<Claimed>(
      `WITH due AS (
         SELECT id FROM outbox WHERE status = 'pending' AND run_at <= $1
          ORDER BY run_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox o SET status = 'processing', locked_at = $1, locked_by = $3, attempts = o.attempts + 1
         FROM due WHERE o.id = due.id
       RETURNING o.id, o.event, o.payload, o.attempts, o.max_attempts`,
      [new Date(now), limit, this.instanceId],
    );
    return rows.sort((a, b) => a.id - b.id);
  }

  private async runBatch(): Promise<number> {
    const claimed = await this.claim();
    if (claimed.length === 0) return 0;
    const concurrency = this.d.config.OUTBOX_CONCURRENCY;
    let next = 0;
    const lanes = Array.from({ length: Math.min(concurrency, claimed.length) }, async () => {
      while (next < claimed.length) {
        const row = claimed[next++]!;
        const run = this.handle(row);
        this.inFlight.add(run);
        try {
          await run;
        } finally {
          this.inFlight.delete(run);
        }
      }
    });
    await Promise.all(lanes);
    return claimed.length;
  }

  private async handle(row: Claimed): Promise<void> {
    const started = Date.now();
    const handler = handlerFor(row.event);
    const { __sensitive: sensitive, ...payload } = row.payload;
    try {
      if (!handler) throw new Error(`no handler registered for ${row.event}`);
      await handler(payload, {
        eventId: row.id,
        attempt: row.attempts,
        deps: this.d,
        now: this.d.clock.now(),
      });
      await this.d.hooks.at('outbox:afterHandler');
      await this.d.pool.query(
        `UPDATE outbox SET status = 'done', finished_at = $2, locked_at = NULL, locked_by = NULL,
                payload = CASE WHEN $3 THEN '{}'::jsonb ELSE payload END
          WHERE id = $1 AND status = 'processing'`,
        [row.id, new Date(this.d.clock.now()), sensitive === true],
      );
      this.d.log.info(
        {
          event: row.event,
          eventId: row.id,
          attempt: row.attempts,
          durationMs: Date.now() - started,
          outcome: 'done',
        },
        'outbox event handled',
      );
    } catch (error) {
      await this.fail(row, error, Date.now() - started);
    }
  }

  private async fail(row: Claimed, error: unknown, durationMs: number): Promise<void> {
    const now = this.d.clock.now();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, ERROR_CHARS);
    const dead = row.attempts >= row.max_attempts;
    const runAt = dead ? now : now + backoffMs(row.attempts);
    const { rows } = await this.d.pool.query<{ status: string }>(RELEASE_SQL, [
      row.id,
      dead ? 'dead' : 'pending',
      new Date(runAt),
      message,
      new Date(now),
    ]);
    const outcome = rows[0]?.status ?? 'unknown';
    const line = {
      event: row.event,
      eventId: row.id,
      attempt: row.attempts,
      durationMs,
      outcome,
      err: error,
    };
    if (outcome === 'dead') {
      this.d.log.error(line, 'outbox event is dead');
      await this.onDead(row);
    } else {
      this.d.log.warn(line, 'outbox event failed');
    }
  }

  /** One `system` notification to admins, keyed by the event id (§9.3 step 5). */
  private async onDead(row: Claimed): Promise<void> {
    try {
      await withTransaction(this.d, (tx) =>
        notifyStaff(
          tx,
          {
            type: 'system',
            title: 'A background task failed',
            body: `A background task failed: ${row.event}`,
            key: `outbox-dead-${row.id}`,
          },
          { adminsOnly: true },
        ),
      );
    } catch (error) {
      this.d.log.error({ err: error, eventId: row.id }, 'could not notify admins about a dead outbox event');
    }
  }

  /** Rows `processing` for more than 5 minutes belong to an instance that died: give them back, one by one. */
  async reap(): Promise<number> {
    const now = this.d.clock.now();
    const { rows } = await this.d.pool.query<{ id: number }>(
      `SELECT id FROM outbox WHERE status = 'processing' AND locked_at < $1 ORDER BY id`,
      [new Date(now - STUCK_AFTER_MS)],
    );
    let released = 0;
    for (const row of rows) {
      try {
        await this.d.pool.query(RELEASE_SQL, [
          row.id,
          'pending',
          new Date(now),
          'released by the reaper',
          new Date(now),
        ]);
        released += 1;
      } catch (error) {
        this.d.log.error({ err: error, eventId: row.id }, 'outbox reaper could not release a row');
      }
    }
    return released;
  }
}
