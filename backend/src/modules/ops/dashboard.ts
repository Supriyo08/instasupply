/**
 * The ops read models (docs/PLATFORM.md §5.3.10): `OpsDashboard` (counters computed by the server in one
 * request; it also feeds the sidebar badges), the store statistics and the scheduler state.
 */
import {
  isStoreOpenAt,
  localDateOf,
  startOfLocalDay,
  type JobState,
  type OpsDashboard,
  type OpsStoreRow,
  type StoreOrderStatus,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import { describeSchedule, registeredJobs } from '../../platform/scheduler/registry';
import { toStore } from '../stores';
import { dashboardCounters, openStoreOrdersByStatus, schedulerState, storeStatistics } from './repository';

export async function buildDashboard(deps: Deps, now: number): Promise<OpsDashboard> {
  const todayStart = startOfLocalDay(localDateOf(now));
  const [row, byStatus] = await Promise.all([
    dashboardCounters(deps.pool, now, todayStart),
    openStoreOrdersByStatus(deps.pool),
  ]);
  const storeOrdersByStatus: Partial<Record<StoreOrderStatus, number>> = {};
  for (const { status, count } of byStatus) storeOrdersByStatus[status] = count;
  return {
    today: { orders: row.today_orders, gmvCents: row.today_gmv_cents },
    storeOrdersByStatus,
    acceptOverdue: row.accept_overdue,
    jobOffers: {
      scheduled: row.offers_scheduled,
      open: row.offers_open,
      unclaimedOver15Min: row.offers_unclaimed,
    },
    activeDeliveries: row.active_deliveries,
    failedDeliveries: row.failed_store_orders,
    liveStores: row.live_stores,
    quotes: { waiting: row.quotes_waiting, nearRespondBy: row.quotes_near },
    issues: { open: row.issues_open, pastSla: row.issues_past_sla },
    unreadSupport: row.unread_support,
    captureFailures: row.capture_failures,
    pendingDrivers: row.pending_drivers,
    unreadDriverChat: row.unread_chat,
    generatedAt: now,
  };
}

export async function buildStoreRows(deps: Deps, now: number, origin: string): Promise<OpsStoreRow[]> {
  const rows = await storeStatistics(deps.pool, now);
  return rows.map((row) => {
    const store = toStore(
      {
        id: row.id,
        doc: { ...row.doc, photoPath: row.doc.photoPath ?? null },
        ratingSum: row.rating_sum,
        ratingCount: row.rating_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      origin,
    );
    return {
      store,
      liveProducts: row.live_products,
      ordersLast7Days: row.orders_7d,
      medianAcceptSeconds:
        row.median_accept_seconds === null ? null : Math.round(Number(row.median_accept_seconds)),
      openNow: store.status === 'live' && isStoreOpenAt(store, now),
    };
  });
}

/** Every registered job with its scheduler row (the payouts page reads the last runDailyPayouts here). */
export async function buildJobStates(deps: Deps): Promise<JobState[]> {
  const state = new Map((await schedulerState(deps.pool)).map((row) => [row.job, row]));
  return registeredJobs().map((job) => {
    const row = state.get(job.name);
    return {
      job: job.name,
      schedule: describeSchedule(job.schedule),
      nextRunAt: row?.next_run_at ?? 0,
      lastStartedAt: row?.last_started_at ?? null,
      lastFinishedAt: row?.last_finished_at ?? null,
      lastStatus: row?.last_status ?? null,
      lastError: row?.last_error ?? null,
      lastResult: row?.last_result ?? null,
    };
  });
}
