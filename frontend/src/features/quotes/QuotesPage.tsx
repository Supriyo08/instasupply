/**
 * `/quotes` (MARKETPLACE §9, CLIENTS §4.5): the material-list inbox by status, soonest deadline first,
 * with the 30-minute SLA countdown ("Due in 12:00") and "Assign to me" (submitted → in review).
 */
import { usePagedQuery } from '@instasupply/api-client/react';
import {
  QUOTE_SLA_MIN,
  formatDateTimeET,
  formatMoney,
  formatRelativeTime,
  pluralize,
  type Quote,
  type QuoteStatus,
} from '@instasupply/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Countdown } from '@/components/ui/Countdown';
import { LoadMore } from '@/components/ui/Data';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { ChevronRightIcon, UserIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { ArtEmptyState } from '@/features/orders/components/ItemThumb';
import { api, describeError, queries } from '@/lib/api';
import { useNow, useOpsDashboard } from '@/lib/data';

import { QUOTE_STATUS_META, neededByLabel } from './quote-format';

type Tab = 'waiting' | 'quoted' | 'accepted' | 'closed' | 'all';

const STATUSES: Record<Tab, QuoteStatus[] | null> = {
  waiting: ['submitted', 'in_review'],
  quoted: ['quoted'],
  accepted: ['accepted'],
  closed: ['declined', 'expired', 'cancelled'],
  all: null,
};

export function AssignQuoteToMe({ quote }: { quote: Pick<Quote, 'id' | 'status' | 'assignedTo'> }) {
  const { user } = useSignedInUser();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!['submitted', 'in_review'].includes(quote.status) || quote.assignedTo === user.uid) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={UserIcon}
      loading={busy}
      onClick={() => {
        setBusy(true);
        api.quotes
          .update(quote.id, { assignedTo: user.uid, status: 'in_review' })
          .catch((error: unknown) => toast.error("Couldn't assign the list", describeError(error)))
          .finally(() => setBusy(false));
      }}
    >
      Assign to me
    </Button>
  );
}

/** The SLA line: the answer is due within 30 minutes of support hours; an offer is valid until a time. */
export function QuoteDeadline({ quote }: { quote: Quote }) {
  if (quote.status === 'submitted' || quote.status === 'in_review') {
    return (
      <Countdown deadline={quote.respondBy} prefix="Due in" overdueLabel="Late by" warnMs={15 * 60_000} />
    );
  }
  if (quote.status === 'quoted' && quote.offerValidUntil) {
    return <span className="text-slate-600">Valid until {formatDateTimeET(quote.offerValidUntil)}</span>;
  }
  return null;
}

function QuoteRow({ quote, now }: { quote: Quote; now: number }) {
  const status = QUOTE_STATUS_META[quote.status];
  const lines = quote.request.lines;
  return (
    <tr className="transition-colors hover:bg-slate-50">
      <td className="px-5 py-3 align-top">
        <Link
          to={`/quotes/${encodeURIComponent(quote.id)}`}
          className="font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
        >
          {quote.number}
        </Link>
        <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(quote.createdAt, now)}</p>
      </td>
      <td className="max-w-56 px-3 py-3 align-top">
        <p className="truncate font-medium text-slate-900">{quote.companyName ?? quote.customerName}</p>
        <p className="truncate text-xs text-slate-500">
          {quote.request.fulfilment === 'pickup' ? 'Pickup' : (quote.request.jobsite?.areaLabel ?? 'Jobsite')}{' '}
          · {neededByLabel(quote.request.neededBy)}
        </p>
      </td>
      <td className="hidden max-w-72 px-3 py-3 align-top md:table-cell">
        <p className="text-slate-700">
          {pluralize(lines.length, 'line')}
          {quote.request.attachments.length > 0
            ? ` · ${pluralize(quote.request.attachments.length, 'file')}`
            : ''}
        </p>
        <p className="truncate text-xs text-slate-500">{lines.map((line) => line.text).join(', ')}</p>
      </td>
      <td className="px-3 py-3 align-top">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        <p className="mt-1 text-xs">
          <QuoteDeadline quote={quote} />
        </p>
        {quote.offer ? (
          <p className="mt-1 text-xs text-slate-500">
            v{quote.offer.version} · {formatMoney(quote.offer.pricing.totalCents)}
          </p>
        ) : null}
      </td>
      <td className="hidden px-3 py-3 align-top text-xs text-slate-600 lg:table-cell">
        {quote.assignedName ?? 'Unassigned'}
      </td>
      <td className="px-3 py-3 align-top">
        <AssignQuoteToMe quote={quote} />
      </td>
      <td className="py-3 pr-5 align-top text-slate-300">
        <ChevronRightIcon size={16} aria-hidden />
      </td>
    </tr>
  );
}

export default function QuotesPage() {
  const now = useNow();
  const [tab, setTab] = useState<Tab>('waiting');
  const statuses = STATUSES[tab];
  const quotes = usePagedQuery(queries.opsQuotes(statuses ? { status: statuses } : {}));
  const dashboard = useOpsDashboard().data;

  return (
    <>
      <PageHeader
        title="Quotes"
        description={`Material lists from contractors. Answer each one within ${QUOTE_SLA_MIN} minutes of support hours.`}
      />
      <Tabs<Tab>
        ariaLabel="Quote status"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'waiting', label: 'Waiting', count: dashboard?.quotes.waiting },
          { value: 'quoted', label: 'Quoted' },
          { value: 'accepted', label: 'Accepted' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]}
      />
      {dashboard && dashboard.quotes.nearRespondBy > 0 && tab === 'waiting' ? (
        <p className="mt-3 text-sm font-medium text-amber-700">
          {pluralize(dashboard.quotes.nearRespondBy, 'list')} near the deadline.
        </p>
      ) : null}
      <Card className="mt-4 overflow-hidden" role="tabpanel">
        {quotes.loading && quotes.items.length === 0 ? (
          <PageSpinner label="Loading quotes" />
        ) : quotes.error && quotes.items.length === 0 ? (
          <ErrorState error={quotes.error} onRetry={quotes.retry} className="m-5" />
        ) : quotes.items.length === 0 ? (
          <ArtEmptyState
            artKey="scene-material-list"
            title={tab === 'waiting' ? 'Every list is answered' : 'Nothing here'}
            description="Contractors send material lists and photos from the app's Quote tab."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Material lists, soonest deadline first</caption>
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      List
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Customer
                    </th>
                    <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">
                      Request
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
                      Assigned
                    </th>
                    <th scope="col" className="px-3 py-3">
                      <span className="sr-only">Assign</span>
                    </th>
                    <th scope="col" className="w-10 py-3 pr-5">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quotes.items.map((quote) => (
                    <QuoteRow key={quote.id} quote={quote} now={now} />
                  ))}
                </tbody>
              </table>
            </div>
            <LoadMore
              hasMore={quotes.hasMore}
              loadingMore={quotes.loadingMore}
              onLoadMore={quotes.loadMore}
            />
          </>
        )}
      </Card>
    </>
  );
}
