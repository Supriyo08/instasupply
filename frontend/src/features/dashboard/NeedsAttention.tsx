import {
  formatRelativeTime,
  pluralize,
  type Issue,
  type JobOffer,
  type Order,
  type Quote,
  type StoreOrder,
} from '@instasupply/shared';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatCountdown } from '@/components/ui/Countdown';
import {
  CardIcon,
  ChevronRightIcon,
  ClockIcon,
  FailedIcon,
  IssueIcon,
  JobsIcon,
  QuoteIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { SceneEmpty } from '@/features/deliveries/components/SceneArt';
import type { DriverRow } from '@/features/live-map/DriverList';
import { cn } from '@/lib/cn';
import { presenceOf, type DriverRecord } from '@/lib/data';

export interface AttentionItem {
  key: string;
  to: string;
  icon?: IconComponent;
  avatar?: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
}

const TONE = {
  danger: 'bg-rose-50 text-rose-600',
  warning: 'bg-amber-50 text-amber-600',
  info: 'bg-brand-50 text-brand-600',
};

/** At most this many rows per kind; a "see all" row links to the full list. */
const PER_KIND = 3;
const UNCLAIMED_MS = 15 * 60_000;
const QUOTE_SOON_MS = 10 * 60_000;

export interface AttentionInput {
  overdue: StoreOrder[];
  overdueCount: number;
  failed: StoreOrder[];
  failedCount: number;
  offers: (JobOffer & { id: string })[];
  issues: Issue[];
  quotes: Quote[];
  captureFailures: Order[];
  captureFailureCount: number;
  pendingDrivers: DriverRecord[];
  fleet: DriverRow[];
  now: number;
}

function more(
  items: AttentionItem[],
  total: number,
  shown: number,
  item: Omit<AttentionItem, 'title'> & { noun: string },
) {
  if (total > shown) {
    items.push({ ...item, title: `${total - shown} more ${item.noun}`, key: `${item.key}-more` });
  }
}

/**
 * The exceptions of MARKETPLACE §9 "Needs attention": overdue acceptances, failed deliveries, unclaimed
 * job offers, issues past SLA, quotes near their reply deadline and card capture failures, plus drivers
 * who lost signal with a load and sign-ups waiting for approval. Every list is the server's (never a
 * capped client list), and the counts come from `GET /ops/dashboard` (R47, R48, R54).
 */
export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { now } = input;

  input.overdue.slice(0, PER_KIND).forEach((order) =>
    items.push({
      key: `overdue-${order.id}`,
      to: `/orders/${order.orderId}`,
      icon: ClockIcon,
      tone: 'danger',
      title: `${order.storeName} hasn't accepted ${order.number}`,
      detail: `Due ${formatRelativeTime(order.timing.respondBy, now)} · ${order.companyName ?? order.customerName}`,
    }),
  );
  more(items, Math.max(input.overdueCount, input.overdue.length), Math.min(PER_KIND, input.overdue.length), {
    key: 'overdue',
    to: '/orders?tab=store-orders',
    icon: ClockIcon,
    tone: 'danger',
    detail: 'Store orders past their acceptance deadline',
    noun: 'overdue acceptances',
  });

  input.failed.slice(0, PER_KIND).forEach((order) =>
    items.push({
      key: `failed-${order.id}`,
      to: order.deliveryId ? `/deliveries/${order.deliveryId}` : `/orders/${order.orderId}`,
      icon: FailedIcon,
      tone: 'danger',
      title: `Delivery of ${order.number} failed`,
      detail: `${order.storeName} → ${order.jobsite?.areaLabel ?? 'site'} · re-attempt or return to the store`,
    }),
  );
  more(items, Math.max(input.failedCount, input.failed.length), Math.min(PER_KIND, input.failed.length), {
    key: 'failed',
    to: '/deliveries?tab=failed',
    icon: FailedIcon,
    tone: 'danger',
    detail: 'Failed deliveries waiting for a decision',
    noun: 'failed deliveries',
  });

  const unclaimed = input.offers
    .filter((offer) => offer.status === 'open' && now - (offer.openedAt ?? offer.opensAt) > UNCLAIMED_MS)
    .sort((a, b) => (a.openedAt ?? a.opensAt) - (b.openedAt ?? b.opensAt));
  unclaimed.slice(0, PER_KIND).forEach((offer) =>
    items.push({
      key: `offer-${offer.id}`,
      to: '/jobs',
      icon: JobsIcon,
      tone: 'warning',
      title: `Nobody has claimed ${offer.storeOrderNumber}`,
      detail: `${offer.pickup.storeName} → ${offer.dropoff.areaLabel} · open ${formatRelativeTime(offer.openedAt ?? offer.opensAt, now).replace(' ago', '')}`,
    }),
  );
  more(items, unclaimed.length, Math.min(PER_KIND, unclaimed.length), {
    key: 'offers',
    to: '/jobs',
    icon: JobsIcon,
    tone: 'warning',
    detail: 'Open on the job board for more than 15 minutes',
    noun: 'unclaimed jobs',
  });

  const lateIssues = input.issues.filter((issue) => issue.slaDueAt < now);
  lateIssues.slice(0, PER_KIND).forEach((issue) =>
    items.push({
      key: `issue-${issue.id}`,
      to: `/issues/${issue.id}`,
      icon: IssueIcon,
      tone: 'danger',
      title: `${issue.number} is past its reply time`,
      detail: `${issue.storeName} · ${issue.customerName} · due ${formatRelativeTime(issue.slaDueAt, now)}`,
    }),
  );
  more(items, lateIssues.length, Math.min(PER_KIND, lateIssues.length), {
    key: 'issues',
    to: '/issues',
    icon: IssueIcon,
    tone: 'danger',
    detail: 'Issues past their service level',
    noun: 'issues past SLA',
  });

  const soonQuotes = input.quotes
    .filter((quote) => quote.respondBy - now < QUOTE_SOON_MS)
    .sort((a, b) => a.respondBy - b.respondBy);
  soonQuotes.slice(0, PER_KIND).forEach((quote) => {
    const left = quote.respondBy - now;
    items.push({
      key: `quote-${quote.id}`,
      to: `/quotes/${quote.id}`,
      icon: QuoteIcon,
      tone: left <= 0 ? 'danger' : 'warning',
      title:
        left <= 0
          ? `Quote ${quote.number} is overdue`
          : `Quote ${quote.number} due in ${formatCountdown(left)}`,
      detail: `${quote.companyName ?? quote.customerName}${quote.assignedTo ? '' : ' · not assigned'}`,
    });
  });
  more(items, soonQuotes.length, Math.min(PER_KIND, soonQuotes.length), {
    key: 'quotes',
    to: '/quotes',
    icon: QuoteIcon,
    tone: 'warning',
    detail: 'Quotes near their reply deadline',
    noun: 'quotes due soon',
  });

  input.captureFailures.slice(0, PER_KIND).forEach((order) =>
    items.push({
      key: `capture-${order.id}`,
      to: `/orders/${order.id}`,
      icon: CardIcon,
      tone: 'danger',
      title: `Card capture failed for ${order.number}`,
      detail: `${order.companyName ?? order.customerName} · retried every 30 minutes`,
    }),
  );
  more(
    items,
    Math.max(input.captureFailureCount, input.captureFailures.length),
    Math.min(PER_KIND, input.captureFailures.length),
    {
      key: 'captures',
      to: '/orders',
      icon: CardIcon,
      tone: 'danger',
      detail: 'Orders whose card could not be charged',
      noun: 'capture failures',
    },
  );

  for (const row of input.fleet) {
    const carrying = row.active.some((delivery) =>
      ['picked_up', 'in_transit', 'arrived'].includes(delivery.status),
    );
    if (carrying && presenceOf(row.location, now) !== 'online') {
      items.push({
        key: `stale-${row.driver.id}`,
        to: `/drivers/${row.driver.id}`,
        avatar: row.driver.displayName,
        tone: 'warning',
        title: `${row.driver.displayName} lost signal with a load`,
        detail: `${pluralize(row.active.length, 'job')} · last seen ${formatRelativeTime(row.location?.updatedAt, now)}`,
      });
    }
  }

  input.pendingDrivers.slice(0, PER_KIND).forEach((driver) =>
    items.push({
      key: `pending-${driver.id}`,
      to: `/drivers/${driver.id}`,
      avatar: driver.displayName,
      tone: 'info',
      title: `${driver.displayName} is waiting for approval`,
      detail: driver.vehicle
        ? `${driver.vehicle.make} ${driver.vehicle.model} · ${driver.vehicle.plate}`
        : 'New driver sign-up',
    }),
  );
  return items;
}

export function NeedsAttention({
  items,
  loading,
  error,
}: {
  items: AttentionItem[];
  loading: boolean;
  error: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader title="Needs attention" description="Exceptions a dispatcher should handle now." />
      {items.length === 0 ? (
        loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Checking for exceptions…</p>
        ) : error ? (
          <p className="px-5 py-8 text-center text-sm text-rose-600">
            Some lists couldn't load. The counts above are still live.
          </p>
        ) : (
          <SceneEmpty
            artKey="scene-order-confirmed"
            title="All clear"
            description="No late acceptances, failed deliveries or stuck jobs right now."
            className="flex-1"
          />
        )
      ) : (
        <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.to} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                {item.avatar ? (
                  <Avatar name={item.avatar} size="sm" />
                ) : item.icon ? (
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', TONE[item.tone])}>
                    <item.icon size={15} aria-hidden />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{item.title}</span>
                  <span className="block truncate text-xs text-slate-500">{item.detail}</span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 text-slate-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && error ? (
        <p className="border-t border-slate-100 px-5 py-2 text-xs text-rose-600">Some lists couldn't load.</p>
      ) : null}
    </Card>
  );
}
