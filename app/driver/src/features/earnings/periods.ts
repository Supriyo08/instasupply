/**
 * "Today" and "This week" on the Earnings tab (MARKETPLACE §10). The server has no per-period total, so
 * these add up the driver's own ledger entries of the period, and only once the loaded pages reach
 * back past the start of the week: a partial sum is never shown. The unpaid balance is never computed
 * here; it comes from `useBalance` (the server's sum).
 */
import {
  addLocalDays,
  localDateOf,
  startOfLocalDay,
  toMillis,
  weekdayOf,
  type LedgerEntry,
  type Weekday,
} from '@instasupply/shared';
import type { WithId } from '@instasupply/api-client';
import type { PagedResult } from '@instasupply/api-client/react';
import { useEffect, useMemo, useRef } from 'react';

const DAYS_FROM_MONDAY: Record<Weekday, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/** At most this many extra pages are fetched to cover the week; beyond it the totals say so. */
const MAX_AUTO_PAGES = 8;

export interface PeriodStart {
  today: number;
  week: number;
}

/** Midnight today and midnight on Monday of this week, Toronto time. */
export function periodStarts(now: number): PeriodStart {
  const date = localDateOf(now);
  const monday = addLocalDays(date, -DAYS_FROM_MONDAY[weekdayOf(date)]);
  return { today: startOfLocalDay(date), week: startOfLocalDay(monday) };
}

export interface PeriodTotals {
  /** Null until the entries of the whole week are loaded. */
  todayCents: number | null;
  weekCents: number | null;
  todayCount: number;
  weekCount: number;
  /** The week has more entries than the screen loads by itself. */
  incomplete: boolean;
}

/** Sums signed entry amounts per period, loading more pages of `ledger` until the week is covered. */
export function usePeriodTotals(ledger: PagedResult<WithId<LedgerEntry>>, now: number): PeriodTotals {
  const starts = useMemo(() => periodStarts(now), [now]);
  const autoPages = useRef(0);
  const { items, hasMore, loading, loadingMore, loadMore, error } = ledger;
  const oldest = items.length > 0 ? (toMillis(items[items.length - 1]?.createdAt) ?? 0) : null;
  const covered = !hasMore || (oldest != null && oldest < starts.week);
  const capped = !covered && autoPages.current >= MAX_AUTO_PAGES;

  useEffect(() => {
    if (loading || loadingMore || covered || error || autoPages.current >= MAX_AUTO_PAGES) return;
    autoPages.current += 1;
    loadMore();
  }, [loading, loadingMore, covered, error, loadMore]);

  return useMemo(() => {
    let todayCents = 0;
    let weekCents = 0;
    let todayCount = 0;
    let weekCount = 0;
    for (const entry of items) {
      const at = toMillis(entry.createdAt) ?? 0;
      if (at >= starts.week) {
        weekCents += entry.amountCents;
        weekCount += 1;
      }
      if (at >= starts.today) {
        todayCents += entry.amountCents;
        todayCount += 1;
      }
    }
    const ready = !loading && (covered || capped);
    // Today is complete as soon as the pages reach back past midnight.
    const todayReady = !loading && (covered || (oldest != null && oldest < starts.today));
    return {
      todayCents: todayReady ? todayCents : null,
      weekCents: ready ? weekCents : null,
      todayCount,
      weekCount,
      incomplete: capped,
    };
  }, [items, starts, loading, covered, capped, oldest]);
}
