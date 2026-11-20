import { useLiveQuery } from '@instasupply/api-client/react';
import { addLocalDays, formatDuration, localDateOf, startOfLocalDay } from '@instasupply/shared';
import { useMemo, useState, type ReactNode } from 'react';

import { Card, CardHeader } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Segmented } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/Layout';
import { Money } from '@/components/ui/Money';
import { useSupplier } from '@/features/auth/AuthProvider';
import { queries } from '@/lib/api';

import { computeInsights, type RankedRow } from '../components/insights';
import { SceneEmpty } from '../components/SceneArt';

type Range = '7' | '30';

/** `storeCompleted` follows cursors up to this many rows (CLIENTS §4.1). */
const MAX_ROWS = 1_000;

function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {children}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function RankedTable({
  title,
  caption,
  rows,
  nameHeader,
  showOrders,
}: {
  title: string;
  caption: string;
  rows: readonly RankedRow[];
  nameHeader: string;
  showOrders?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">Nothing sold in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  {nameHeader}
                </th>
                {showOrders ? (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Orders
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Units
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Sales
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-64 truncate px-5 py-2 text-slate-900">{row.label}</td>
                  {showOrders ? <td className="px-3 py-2 text-right tabular-nums">{row.orders}</td> : null}
                  <td className="px-3 py-2 text-right tabular-nums">{row.units.toLocaleString('en-CA')}</td>
                  <td className="px-5 py-2 text-right">
                    <Money cents={row.cents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * `/portal/insights` (owner; MARKETPLACE §8, CLIENTS §4.4): the last 7 or 30 days, computed in the
 * page over at most 1 000 completed store orders. Tables only in P0 (charts are P1).
 */
export default function InsightsPage() {
  const { storeId } = useSupplier();
  const [range, setRange] = useState<Range>('7');
  const now = useServerNow(60 * 60_000);
  // From Toronto midnight N−1 days ago, so the query key stays the same all day.
  const today = localDateOf(now);
  const sinceMs = useMemo(() => startOfLocalDay(addLocalDays(today, -(Number(range) - 1))), [range, today]);
  const completed = useLiveQuery(queries.storeCompleted(storeId, sinceMs));
  const insights = useMemo(() => computeInsights(completed.data, sinceMs), [completed.data, sinceMs]);

  let body;
  if (completed.loading && completed.data.length === 0) {
    body = <PageSpinner label="Adding up your sales" />;
  } else if (completed.error && completed.data.length === 0) {
    body = <ErrorState error={completed.error} onRetry={completed.retry} />;
  } else if (insights.orders === 0) {
    body = (
      <Card>
        <SceneEmpty
          artKey="scene-local-suppliers"
          title="No completed orders in this period"
          description="Insights fill in as orders are delivered or picked up."
        />
      </Card>
    );
  } else {
    body = (
      <div className="space-y-6">
        {completed.data.length >= MAX_ROWS ? (
          <p className="text-xs text-amber-700">
            Based on your latest {MAX_ROWS.toLocaleString('en-CA')} completed orders in this period.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Figure label="Sales" hint="Your prices × what you shipped">
            <Money cents={insights.salesCents} />
          </Figure>
          <Figure label="Orders">{insights.orders.toLocaleString('en-CA')}</Figure>
          <Figure label="Average order">
            <Money cents={insights.averageCents} />
          </Figure>
          <Figure label="Fill rate" hint="Units shipped ÷ units ordered">
            {insights.fillRate === null ? '—' : `${(insights.fillRate * 100).toFixed(1)} %`}
          </Figure>
          <Figure label="Median time to accept" hint="From order to your Accept">
            {insights.medianAcceptSeconds === null ? '—' : formatDuration(insights.medianAcceptSeconds)}
          </Figure>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <RankedTable
            title="Top products"
            caption="Your ten best-selling products by sales"
            nameHeader="Product"
            rows={insights.topProducts}
          />
          <RankedTable
            title="Top customers"
            caption="Your ten biggest customers by sales"
            nameHeader="Customer"
            rows={insights.topCustomers}
            showOrders
          />
        </div>
        <RankedTable
          title="Categories"
          caption="Sales by category"
          nameHeader="Category"
          rows={insights.categories}
          showOrders
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Insights"
        description="How your store did on InstaSupply."
        actions={
          <Segmented<Range>
            ariaLabel="Period"
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
            ]}
          />
        }
      />
      {body}
    </>
  );
}
