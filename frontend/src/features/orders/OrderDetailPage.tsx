/**
 * `/orders/:orderId` (MARKETPLACE §9, CLIENTS §4.5): customer, jobsite and window; one card per store
 * order with its status, store, driver, delivery link and the staff actions (act for the store, cancel
 * the store order, resolve a failed delivery, complete a pickup with an override); payment events;
 * issues; the quote it came from; a link to the customer's support chat. Stacked on a phone the
 * customer and jobsite come first, then the store orders, then payment and issues (ux #7).
 */
import { usePagedQuery } from '@instasupply/api-client/react';
import {
  ISSUE_SLA_HOURS,
  VEHICLE_CLASSES,
  formatDateTimeET,
  formatPhone,
  orderHeadline,
  pluralize,
  windowLabel,
  type Order,
} from '@instasupply/shared';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { IssueIcon, MessageIcon, OrdersIcon, PhoneIcon, QuoteIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { LiveStatusBar } from '@/components/ui/LiveStatus';
import { isNetworkError, queries } from '@/lib/api';
import { useNow } from '@/lib/data';

import { AttentionBadge, FulfilmentBadge, OrderStatusBadge } from './components/OrderBadges';
import { PaymentCard } from './components/PaymentCard';
import { StoreOrderCard } from './components/StoreOrderCard';
import { useOrder, useOrderStoreOrders } from './hooks';
import { SOURCE_LABELS, customerLine } from './order-format';

function CustomerCard({ order, now }: { order: Order; now: number }) {
  const site = order.jobsite;
  return (
    <Card>
      <CardHeader
        title="Customer and site"
        action={
          <Link
            to={`/support/${encodeURIComponent(order.customerId)}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            <MessageIcon size={14} aria-hidden /> Support chat
          </Link>
        }
      />
      <CardBody>
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Customer">{customerLine(order)}</DetailRow>
          <DetailRow label="Phone">
            <a
              href={`tel:${order.customerPhone}`}
              className="inline-flex items-center gap-1 text-brand-700 hover:underline"
            >
              <PhoneIcon size={14} aria-hidden /> {formatPhone(order.customerPhone)}
            </a>
          </DetailRow>
          <DetailRow label="Fulfilment">
            <FulfilmentBadge fulfilment={order.fulfilment} />
          </DetailRow>
          {order.window ? <DetailRow label="Window">{windowLabel(order.window, now)}</DetailRow> : null}
          {site ? (
            <>
              <DetailRow label="Jobsite">
                {site.label}
                <span className="block text-xs font-normal text-slate-500">{site.addressLine}</span>
                <span className="block text-xs font-normal text-slate-500">{site.areaLabel}</span>
              </DetailRow>
              <DetailRow label="Receiving">
                {order.receiving === 'unattended' ? 'Unattended: photo proof' : 'Attended: hand-off code'}
              </DetailRow>
              {order.siteContact ? (
                <DetailRow label="Site contact">
                  {order.siteContact.name}
                  <a
                    href={`tel:${order.siteContact.phone}`}
                    className="block text-xs text-brand-700 hover:underline"
                  >
                    {formatPhone(order.siteContact.phone)}
                  </a>
                </DetailRow>
              ) : null}
              {site.maxVehicleClass ? (
                <DetailRow label="Site access">{VEHICLE_CLASSES[site.maxVehicleClass].label} max</DetailRow>
              ) : null}
              {site.instructions ? <DetailRow label="Site notes">{site.instructions}</DetailRow> : null}
            </>
          ) : null}
          {order.instructions ? <DetailRow label="Instructions">{order.instructions}</DetailRow> : null}
        </dl>
      </CardBody>
    </Card>
  );
}

function IssuesCard({ orderId, now }: { orderId: string; now: number }) {
  const issues = usePagedQuery(queries.opsIssues({ orderId }));
  return (
    <Card>
      <CardHeader
        title="Issues"
        description={`Staff aim to resolve each case within ${ISSUE_SLA_HOURS} hours.`}
      />
      <CardBody>
        {issues.error && issues.items.length === 0 ? (
          <ErrorState error={issues.error} onRetry={issues.retry} />
        ) : issues.loading && issues.items.length === 0 ? (
          <p className="text-sm text-slate-500">Loading issues…</p>
        ) : issues.items.length === 0 ? (
          <p className="text-sm text-slate-500">No problems reported on this order.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {issues.items.map((issue) => (
              <li key={issue.id} className="py-2">
                <Link
                  to={`/issues/${encodeURIComponent(issue.id)}`}
                  className="flex items-center justify-between gap-3 hover:text-brand-700"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs font-semibold">{issue.number}</span> ·{' '}
                    {issue.storeOrderNumber} · {issue.type.replace('_', ' ')}
                  </span>
                  <Badge
                    tone={
                      issue.status === 'resolved' ? 'success' : issue.slaDueAt < now ? 'danger' : 'warning'
                    }
                  >
                    {issue.status === 'in_review'
                      ? 'In review'
                      : issue.status === 'open'
                        ? 'Open'
                        : 'Resolved'}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const now = useNow();
  const order = useOrder(orderId);
  const storeOrders = useOrderStoreOrders(orderId);

  if (order.loading && !order.data) return <PageSpinner label="Loading order" />;
  if (!order.data) {
    if (order.error) {
      return (
        <ErrorState
          error={order.error}
          onRetry={order.retry}
          title={isNetworkError(order.error) ? "Can't reach the server" : "Couldn't load this order"}
        />
      );
    }
    return (
      <EmptyState
        icon={OrdersIcon}
        title="Order not found"
        description="Check the order number, or go back to the list."
        action={
          <Link to="/orders" className="text-sm font-semibold text-brand-600">
            All orders
          </Link>
        }
      />
    );
  }

  const data = order.data;
  const cards = storeOrders.data.length > 0 ? storeOrders.data : [];

  return (
    <>
      <PageHeader
        back={{ to: '/orders', label: 'Orders' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{data.number}</span>
            <OrderStatusBadge status={data.status} />
            {data.needsAttention ? <AttentionBadge /> : null}
          </span>
        }
        description={
          <>
            {orderHeadline(data)} · {pluralize(data.storeCount, 'store')} ·{' '}
            {pluralize(data.itemCount, 'item')} · placed {formatDateTimeET(data.createdAt, now)} ·{' '}
            {SOURCE_LABELS[data.source]}
          </>
        }
        actions={
          <>
            <LiveStatusBar />
            {data.quoteId ? (
              <Link
                to={`/quotes/${encodeURIComponent(data.quoteId)}`}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                <QuoteIcon size={16} aria-hidden /> From quote
              </Link>
            ) : null}
            {data.issueId ? (
              <Link
                to={`/issues/${encodeURIComponent(data.issueId)}`}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                <IssueIcon size={16} aria-hidden /> Replacement for an issue
              </Link>
            ) : null}
          </>
        }
      />
      {data.cancelReason ? (
        <p className="-mt-3 mb-4 text-sm text-slate-600">Cancelled: {data.cancelReason}</p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6 xl:col-start-2 xl:row-start-1">
          <CustomerCard order={data} now={now} />
        </div>
        <div className="space-y-6 xl:col-start-1 xl:row-span-3 xl:row-start-1">
          {storeOrders.error && cards.length === 0 ? (
            <ErrorState
              error={storeOrders.error}
              onRetry={storeOrders.retry}
              title="Couldn't load the store orders"
            />
          ) : storeOrders.loading && cards.length === 0 ? (
            <PageSpinner label="Loading store orders" />
          ) : (
            cards.map((storeOrder) => <StoreOrderCard key={storeOrder.id} storeOrder={storeOrder} />)
          )}
        </div>
        <div className="space-y-6 xl:col-start-2 xl:row-start-2">
          <PaymentCard order={data} />
          <IssuesCard orderId={data.id} now={now} />
        </div>
      </div>
    </>
  );
}
