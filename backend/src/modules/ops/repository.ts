/**
 * Every SQL statement of the ops module (docs/PLATFORM.md §5.3.10): the dashboard counters in one statement,
 * the store statistics, the scheduler state, the dev SMS and email outbox, and the transactional outbox.
 */
import type { OutboxEvent, StoreOrderStatus } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { RELEASE_SQL } from '../../platform/outbox/worker';
import type { StoreDoc } from '../stores';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface DashboardRow {
  today_orders: number;
  today_gmv_cents: number;
  accept_overdue: number;
  offers_scheduled: number;
  offers_open: number;
  offers_unclaimed: number;
  active_deliveries: number;
  failed_store_orders: number;
  live_stores: number;
  quotes_waiting: number;
  quotes_near: number;
  issues_open: number;
  issues_past_sla: number;
  unread_support: number;
  capture_failures: number;
  pending_drivers: number;
  unread_chat: number;
}

/** Every counter of `OpsDashboard` but the per-status store orders, in one statement. */
export async function dashboardCounters(
  db: Queryable,
  now: number,
  todayStart: number,
): Promise<DashboardRow> {
  const { rows } = await db.query<DashboardRow>(
    `SELECT
       (SELECT count(*)::int FROM orders WHERE created_at >= $2) AS today_orders,
       (SELECT COALESCE(sum(total_cents), 0)::bigint FROM orders WHERE created_at >= $2 AND status <> 'cancelled')
         AS today_gmv_cents,
       (SELECT count(*)::int FROM store_orders WHERE status = 'new' AND accept_overdue) AS accept_overdue,
       (SELECT count(*)::int FROM job_offers WHERE status = 'scheduled') AS offers_scheduled,
       (SELECT count(*)::int FROM job_offers WHERE status = 'open') AS offers_open,
       (SELECT count(*)::int FROM job_offers WHERE status = 'open' AND opened_at <= $3) AS offers_unclaimed,
       (SELECT count(*)::int FROM deliveries
         WHERE status IN ('assigned', 'accepted', 'picked_up', 'in_transit', 'arrived')) AS active_deliveries,
       (SELECT count(*)::int FROM store_orders WHERE status = 'failed') AS failed_store_orders,
       (SELECT count(*)::int FROM stores WHERE status = 'live') AS live_stores,
       (SELECT count(*)::int FROM quotes WHERE status IN ('submitted', 'in_review')) AS quotes_waiting,
       (SELECT count(*)::int FROM quotes WHERE status IN ('submitted', 'in_review') AND respond_by <= $4)
         AS quotes_near,
       (SELECT count(*)::int FROM issues WHERE status IN ('open', 'in_review')) AS issues_open,
       (SELECT count(*)::int FROM issues WHERE status IN ('open', 'in_review') AND sla_due_at < $1) AS issues_past_sla,
       (SELECT count(*)::int FROM support_threads WHERE unread_by_staff > 0) AS unread_support,
       (SELECT count(*)::int FROM orders WHERE payment_status = 'capture_failed') AS capture_failures,
       (SELECT count(*)::int FROM users WHERE role = 'driver' AND status = 'pending') AS pending_drivers,
       (SELECT count(*)::int FROM chat_threads WHERE unread_by_staff > 0) AS unread_chat`,
    [new Date(now), new Date(todayStart), new Date(now - 15 * MINUTE_MS), new Date(now + 10 * MINUTE_MS)],
  );
  return rows[0]!;
}

/** Store orders that are not final, by status. */
export async function openStoreOrdersByStatus(
  db: Queryable,
): Promise<{ status: StoreOrderStatus; count: number }[]> {
  const { rows } = await db.query<{ status: StoreOrderStatus; count: number }>(
    `SELECT status, count(*)::int AS count FROM store_orders
      WHERE status NOT IN ('delivered', 'picked_up', 'rejected', 'cancelled')
      GROUP BY status ORDER BY status`,
  );
  return rows;
}

export interface StoreStatsRow {
  id: string;
  doc: StoreDoc;
  rating_sum: number;
  rating_count: number;
  created_at: number;
  updated_at: number;
  live_products: number;
  orders_7d: number;
  median_accept_seconds: number | null;
}

/** Every store with live products, store orders of the last 7 days and the median time to accept. */
export async function storeStatistics(db: Queryable, now: number): Promise<StoreStatsRow[]> {
  const { rows } = await db.query<StoreStatsRow>(
    `SELECT s.id, s.doc, s.rating_sum, s.rating_count, s.created_at, s.updated_at,
            (SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.listed) AS live_products,
            (SELECT count(*)::int FROM store_orders so WHERE so.store_id = s.id AND so.created_at >= $1) AS orders_7d,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY
                      ((so.doc #>> '{statusAt,accepted}')::bigint - (extract(epoch FROM so.created_at) * 1000)::bigint)
                      / 1000.0)
               FROM store_orders so
              WHERE so.store_id = s.id AND so.created_at >= $1 AND so.doc #>> '{statusAt,accepted}' IS NOT NULL)
              AS median_accept_seconds
       FROM stores s ORDER BY s.name, s.id`,
    [new Date(now - 7 * DAY_MS)],
  );
  return rows;
}

export interface SchedulerRow {
  job: string;
  next_run_at: number;
  last_started_at: number | null;
  last_finished_at: number | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  last_result: Record<string, unknown> | null;
}

export async function schedulerState(db: Queryable): Promise<SchedulerRow[]> {
  const { rows } = await db.query<SchedulerRow>(
    `SELECT job, next_run_at, last_started_at, last_finished_at, last_status, last_error, last_result
       FROM scheduler_state ORDER BY job`,
  );
  return rows;
}

export interface DevOutboxRow {
  id: string;
  channel: 'sms' | 'email';
  to_address: string;
  subject: string | null;
  body: string | null;
  purpose: 'otp' | 'tracking_link' | 'store_alert' | 'other' | 'password_reset' | 'invite';
  provider: 'outbox' | 'twilio' | 'resend' | 'smtp';
  status: 'stored' | 'sent' | 'failed';
  created_at: number;
}

/** The dev outbox, newest first; sensitive rows only when `includeSensitive` (admins). */
export async function listDevOutbox(
  db: Queryable,
  filter: { channel: 'sms' | 'email' | null; includeSensitive: boolean },
  after: [number, string] | null,
  limit: number,
): Promise<DevOutboxRow[]> {
  const { rows } = await db.query<DevOutboxRow>(
    `SELECT id, channel, to_address, subject, body, purpose, provider, status, created_at FROM dev_outbox
      WHERE ($1::text IS NULL OR channel = $1) AND ($2::boolean OR NOT sensitive)
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::text))
      ORDER BY created_at DESC, id DESC LIMIT $5`,
    [
      filter.channel,
      filter.includeSensitive,
      after ? new Date(after[0]) : null,
      after ? after[1] : null,
      limit + 1,
    ],
  );
  return rows;
}

export interface OutboxRow {
  id: number;
  event: string;
  status: OutboxEvent['status'];
  attempts: number;
  max_attempts: number;
  run_at: number;
  last_error: string | null;
  created_at: number;
  finished_at: number | null;
  payload: Record<string, unknown>;
}

/** The transactional outbox, newest first (by id). */
export async function listOutboxEvents(
  db: Queryable,
  status: 'pending' | 'processing' | 'dead' | null,
  beforeId: number | null,
  limit: number,
): Promise<OutboxRow[]> {
  const { rows } = await db.query<OutboxRow>(
    `SELECT id, event, status, attempts, max_attempts, run_at, last_error, created_at, finished_at, payload
       FROM outbox
      WHERE ($1::text IS NULL OR status = $1) AND ($2::bigint IS NULL OR id < $2::bigint)
      ORDER BY id DESC LIMIT $3`,
    [status, beforeId, limit + 1],
  );
  return rows;
}

export async function outboxStatus(db: Queryable, id: number): Promise<OutboxEvent['status'] | null> {
  const { rows } = await db.query<{ status: OutboxEvent['status'] }>(
    `SELECT status FROM outbox WHERE id = $1`,
    [id],
  );
  return rows[0]?.status ?? null;
}

/**
 * Puts a `dead` event back to `pending` with `attempts = 0` through statement (m) of §3.5: when a newer
 * pending row with the same dedupe key exists, the dead row is finished as `done` instead. Answers the new
 * status, or null when the row is not dead.
 */
export async function retryDeadEvent(tx: Tx, id: number): Promise<string | null> {
  const locked = await tx.query<{ id: number }>(
    `SELECT id FROM outbox WHERE id = $1 AND status = 'dead' FOR UPDATE`,
    [id],
  );
  if (locked.rows.length === 0) return null;
  const { rows } = await tx.query<{ status: string }>(RELEASE_SQL, [
    id,
    'pending',
    new Date(tx.now),
    'retried by an administrator',
    new Date(tx.now),
  ]);
  const status = rows[0]?.status ?? null;
  if (status === 'pending') {
    await tx.query(
      `UPDATE outbox SET attempts = 0, finished_at = NULL WHERE id = $1 AND status = 'pending'`,
      [id],
    );
    await tx.query(`SELECT pg_notify('is_outbox', '')`);
  }
  return status;
}
