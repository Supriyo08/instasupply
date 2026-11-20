import type { WithId } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  formatDateTimeET,
  formatDayET,
  fromLocal,
  pluralize,
  type LedgerEntry,
  type LedgerKind,
  type Payout,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { LoadMore } from '@/components/ui/Data';
import { EmptyState, ErrorState, PageSpinner, Skeleton } from '@/components/ui/Feedback';
import { ChevronDownIcon, ClockIcon, LockIcon, PayoutIcon, ReceiptIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { Money } from '@/components/ui/Money';
import { useSupplier } from '@/features/auth/AuthProvider';
import { queries } from '@/lib/api';
import { cn } from '@/lib/cn';

import { SceneEmpty } from '../components/SceneArt';

const KIND_LABELS: Record<LedgerKind, string> = {
  sale: 'Sale',
  commission: 'Commission',
  delivery: 'Delivery pay',
  failed_attempt: 'Failed attempt',
  cancellation: 'Cancellation',
  clawback: 'Clawback',
  adjustment: 'Adjustment',
};

function Tile({
  label,
  cents,
  hint,
  loading,
}: {
  label: string;
  cents: number | null;
  hint?: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
          <Money cents={cents} />
        </p>
      )}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function EntryRows({
  entries,
  now,
  issueLabels,
}: {
  entries: readonly WithId<LedgerEntry>[];
  now: number;
  issueLabels?: ReadonlyMap<string, string>;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="text-slate-900">
              <span className="font-medium">{KIND_LABELS[entry.kind]}</span>
              {entry.storeOrderId ? (
                <Link
                  to={`/portal/orders/${encodeURIComponent(entry.storeOrderId)}`}
                  className="ml-2 font-mono text-xs text-brand-700 hover:underline"
                >
                  {entry.storeOrderId}
                </Link>
              ) : null}
            </p>
            <p className="truncate text-xs text-slate-500">
              {entry.description} · {formatDateTimeET(entry.createdAt, now)}
            </p>
            {entry.heldForIssueId ? (
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700">
                <LockIcon size={12} aria-hidden /> On hold:{' '}
                {issueLabels?.get(entry.heldForIssueId) ?? 'a customer issue is open on this order'}
              </p>
            ) : null}
          </div>
          <Money
            cents={entry.amountCents}
            className={cn('shrink-0 font-medium', entry.amountCents < 0 ? 'text-rose-700' : 'text-slate-900')}
          />
        </li>
      ))}
    </ul>
  );
}

function LedgerCard({
  title,
  description,
  storeId,
  filters,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  storeId: string;
  filters: { held?: boolean; unpaid?: boolean };
  emptyTitle: string;
  emptyDescription: string;
}) {
  const entries = usePagedQuery(queries.ledger('store', storeId, filters));
  const issues = usePagedQuery(queries.storeIssues(storeId), { enabled: filters.held === true });
  const now = useServerNow(60_000);
  const issueLabels = useMemo(
    () =>
      new Map(
        issues.items.map((issue) => [
          issue.id,
          `${issue.number} (${issue.status === 'resolved' ? 'resolved' : issue.status === 'in_review' ? 'in review' : 'open'}): ${issue.description}`,
        ]),
      ),
    [issues.items],
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      {entries.loading && entries.items.length === 0 ? (
        <PageSpinner label={`Loading ${title.toLowerCase()}`} />
      ) : entries.error && entries.items.length === 0 ? (
        <div className="p-5">
          <ErrorState error={entries.error} onRetry={entries.retry} />
        </div>
      ) : entries.items.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <EntryRows entries={entries.items} now={now} issueLabels={issueLabels} />
          <LoadMore
            hasMore={entries.hasMore}
            loadingMore={entries.loadingMore}
            onLoadMore={entries.loadMore}
          />
        </>
      )}
    </Card>
  );
}

/** Totals of one payout's entries by kind, shown once every entry of the payout is loaded. */
function breakdown(entries: readonly LedgerEntry[]) {
  const byKind = new Map<LedgerKind, number>();
  const orders = new Set<string>();
  for (const entry of entries) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + entry.amountCents);
    if (entry.storeOrderId) orders.add(entry.storeOrderId);
  }
  return { byKind, orders: orders.size };
}

function PayoutEntries({ storeId, payout }: { storeId: string; payout: WithId<Payout> }) {
  const entries = usePagedQuery(queries.ledger('store', storeId, { payoutId: payout.id }));
  const now = useServerNow(60_000);
  if (entries.loading && entries.items.length === 0) return <PageSpinner label="Loading entries" />;
  if (entries.error && entries.items.length === 0) {
    return (
      <div className="p-4">
        <ErrorState error={entries.error} onRetry={entries.retry} />
      </div>
    );
  }
  const complete = !entries.hasMore;
  const summary = breakdown(entries.items);
  return (
    <div className="bg-slate-50/70">
      {complete ? (
        <dl className="grid grid-cols-2 gap-3 px-5 py-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Orders</dt>
            <dd className="font-medium text-slate-900 tabular-nums">{summary.orders}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Sales</dt>
            <dd className="font-medium text-slate-900">
              <Money cents={summary.byKind.get('sale') ?? 0} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Commission</dt>
            <dd className="font-medium text-slate-900">
              <Money cents={summary.byKind.get('commission') ?? 0} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Clawbacks and adjustments</dt>
            <dd className="font-medium text-slate-900">
              <Money
                cents={(summary.byKind.get('clawback') ?? 0) + (summary.byKind.get('adjustment') ?? 0)}
              />
            </dd>
          </div>
        </dl>
      ) : (
        <p className="px-5 py-3 text-xs text-slate-500">
          Load every entry to see the totals by type. The payout net above is final.
        </p>
      )}
      <EntryRows entries={entries.items} now={now} />
      <LoadMore hasMore={entries.hasMore} loadingMore={entries.loadingMore} onLoadMore={entries.loadMore} />
    </div>
  );
}

function PayoutStatus({ status }: { status: Payout['status'] }) {
  if (status === 'paid') return <Badge tone="success">Paid</Badge>;
  if (status === 'failed') return <Badge tone="danger">Failed: InstaSupply is retrying</Badge>;
  return <Badge tone="warning">Sending</Badge>;
}

function PayoutsCard({ storeId }: { storeId: string }) {
  const payouts = usePagedQuery(queries.payouts('store', storeId));
  const now = useServerNow(60_000);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Daily payouts"
        description="One transfer per day for the orders completed by the cut-off."
      />
      {payouts.loading && payouts.items.length === 0 ? (
        <PageSpinner label="Loading payouts" />
      ) : payouts.error && payouts.items.length === 0 ? (
        <div className="p-5">
          <ErrorState error={payouts.error} onRetry={payouts.retry} />
        </div>
      ) : payouts.items.length === 0 ? (
        <SceneEmpty
          artKey="scene-order-confirmed"
          title="No payouts yet"
          description="Your first payout is sent the day after your first completed order."
        />
      ) : (
        <>
          <div className="hidden grid-cols-[1.2fr_0.6fr_1fr_1fr_1fr_1.2fr_auto] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs font-medium text-slate-500 md:grid">
            <span>Date</span>
            <span className="text-right">Entries</span>
            <span className="text-right">Sales and credits</span>
            <span className="text-right">Commission and clawbacks</span>
            <span className="text-right">Net</span>
            <span>Reference</span>
            <span className="sr-only">Details</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {payouts.items.map((payout) => {
              const open = openId === payout.id;
              const panelId = `payout-${payout.id}`;
              return (
                <li key={payout.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenId(open ? null : payout.id)}
                    className="grid w-full grid-cols-2 items-center gap-3 px-5 py-3 text-left text-sm hover:bg-slate-50 md:grid-cols-[1.2fr_0.6fr_1fr_1fr_1fr_1.2fr_auto]"
                  >
                    <span>
                      <span className="font-medium text-slate-900">
                        {formatDayET(fromLocal(payout.periodDate, 12 * 60), now)}
                      </span>
                      <span className="ml-2 md:hidden">
                        <PayoutStatus status={payout.status} />
                      </span>
                    </span>
                    <span className="text-right text-slate-600 tabular-nums md:block">
                      <span className="md:hidden">{pluralize(payout.entryCount, 'entry', 'entries')}</span>
                      <span className="hidden md:inline">{payout.entryCount}</span>
                    </span>
                    <Money cents={payout.creditsCents} className="hidden text-right md:block" />
                    <Money
                      cents={-Math.abs(payout.debitsCents)}
                      className="hidden text-right text-rose-700 md:block"
                    />
                    <Money cents={payout.netCents} className="text-right font-semibold text-slate-900" />
                    <span className="hidden min-w-0 items-center gap-2 md:flex">
                      <span className="truncate font-mono text-xs text-slate-600">
                        {payout.reference ?? '—'}
                      </span>
                      <PayoutStatus status={payout.status} />
                    </span>
                    <ChevronDownIcon
                      size={16}
                      aria-hidden
                      className={cn(
                        'justify-self-end text-slate-400 transition-transform',
                        open && 'rotate-180',
                      )}
                    />
                  </button>
                  {open ? (
                    <div id={panelId}>
                      <PayoutEntries storeId={storeId} payout={payout} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <LoadMore
            hasMore={payouts.hasMore}
            loadingMore={payouts.loadingMore}
            onLoadMore={payouts.loadMore}
          />
        </>
      )}
    </Card>
  );
}

/**
 * `/portal/payouts` (owner; MARKETPLACE §8, CLIENTS §4.4): the unpaid balance from the server (never
 * summed from a page), held entries with their reason, unpaid entries, and daily payouts with a
 * drill-down to their entries.
 */
export default function PortalPayoutsPage() {
  const { storeId } = useSupplier();
  const balance = useLiveQuery(queries.ledgerBalance('store', storeId));
  const now = useServerNow(60_000);
  const data = balance.data;
  const [showUnpaid, setShowUnpaid] = useState(false);

  return (
    <>
      <PageHeader
        title="Payouts"
        description="What InstaSupply owes your store, and every transfer we sent."
        actions={
          <Button
            variant="secondary"
            icon={ReceiptIcon}
            onClick={() => setShowUnpaid((value) => !value)}
            aria-expanded={showUnpaid}
          >
            {showUnpaid ? 'Hide unpaid entries' : 'Show unpaid entries'}
          </Button>
        }
      />
      {balance.error && !data ? (
        <ErrorState className="mb-6" error={balance.error} onRetry={balance.retry} />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Tile
            label="Unpaid balance"
            cents={data?.unpaidCents ?? null}
            loading={balance.loading && !data}
            hint={data ? `${pluralize(data.unpaidCount, 'entry', 'entries')} for the next payout` : undefined}
          />
          <Tile
            label="On hold"
            cents={data?.heldCents ?? null}
            loading={balance.loading && !data}
            hint={
              data ? `${pluralize(data.heldCount, 'entry', 'entries')} waiting on customer issues` : undefined
            }
          />
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Last paid</p>
            <p className="mt-1.5 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <ClockIcon size={18} aria-hidden className="text-slate-400" />
              {data?.lastPaidAt ? formatDateTimeET(data.lastPaidAt, now) : balance.loading ? '…' : 'Not yet'}
            </p>
            <p className="mt-1 text-xs text-slate-500">Payouts go to the account InstaSupply has on file.</p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {data && data.heldCount > 0 ? (
          <LedgerCard
            title="On hold"
            description="Held while a customer issue on that order is open. Released once InstaSupply resolves it."
            storeId={storeId}
            filters={{ held: true }}
            emptyTitle="Nothing on hold"
            emptyDescription="Entries wait here while a customer issue is open."
          />
        ) : null}
        {showUnpaid ? (
          <LedgerCard
            title="Unpaid entries"
            description="Sales, commission and clawbacks that go into the next payout."
            storeId={storeId}
            filters={{ unpaid: true }}
            emptyTitle="Nothing unpaid"
            emptyDescription="Completed orders add entries here until the next payout."
          />
        ) : null}
        <PayoutsCard storeId={storeId} />
      </div>
      {!data && !balance.loading && !balance.error ? (
        <EmptyState icon={PayoutIcon} title="No balance yet" />
      ) : null}
    </>
  );
}
