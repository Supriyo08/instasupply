/**
 * `/support`, `/support/:threadId` (MARKETPLACE §9, CLIENTS §4.5): customer and store threads in
 * tabs, unread first; assignment and status; a side panel with the owner's recent orders, open
 * issues and quotes. A customer thread's id is their uid, a store's is `store_{storeId}`; a thread
 * opened from an order or store page before anyone wrote starts with the first message.
 */
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  formatMoney,
  formatRelativeTime,
  type SupportThread,
  type SupportThreadKind,
  type WithId,
} from '@instasupply/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Segmented, Select } from '@/components/ui/Form';
import { BackIcon, StoreIcon, UserIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { ArtEmptyState } from '@/features/orders/components/ItemThumb';
import { OrderStatusBadge, StoreOrderStatusBadge } from '@/features/orders/components/OrderBadges';
import { api, describeError, queries } from '@/lib/api';
import { useNow, useStaff, useOpsDashboard } from '@/lib/data';
import { cn } from '@/lib/cn';

import { SupportConversation } from './SupportConversation';

type StatusFilter = 'open' | 'resolved' | 'all';

/** "store_kestrel-lumber" → the store; anything else is a customer uid. */
function ownerOf(threadId: string): { kind: SupportThreadKind; ownerId: string } {
  return threadId.startsWith('store_')
    ? { kind: 'store', ownerId: threadId.slice('store_'.length) }
    : { kind: 'customer', ownerId: threadId };
}

function ThreadList({
  threads,
  selected,
  now,
}: {
  threads: WithId<SupportThread>[];
  selected: string | undefined;
  now: number;
}) {
  return (
    <ul className="divide-y divide-slate-100" aria-label="Conversations">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            to={`/support/${encodeURIComponent(thread.id)}`}
            aria-current={thread.id === selected ? 'page' : undefined}
            className={cn(
              'block px-4 py-3 hover:bg-slate-50',
              thread.id === selected && 'bg-brand-50/60 hover:bg-brand-50',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'truncate text-sm',
                  thread.unreadByStaff > 0 ? 'font-semibold text-slate-900' : 'text-slate-800',
                )}
              >
                {thread.companyName ? `${thread.ownerName} · ${thread.companyName}` : thread.ownerName}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">
                {thread.lastMessage ? formatRelativeTime(thread.lastMessage.at, now) : ''}
              </span>
            </span>
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-slate-500">
                {thread.lastMessage
                  ? `${thread.lastMessage.senderRole === 'staff' ? 'You: ' : ''}${thread.lastMessage.text}`
                  : 'No messages'}
              </span>
              {thread.unreadByStaff > 0 ? (
                <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white">
                  {thread.unreadByStaff}
                </span>
              ) : null}
            </span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              {thread.status === 'resolved' ? <Badge tone="success">Resolved</Badge> : null}
              {thread.assignedName ? <Badge tone="neutral">{thread.assignedName}</Badge> : null}
              {thread.context ? <Badge tone="info">{thread.context.label}</Badge> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ThreadHeader({ threadId, thread }: { threadId: string; thread: WithId<SupportThread> | null }) {
  const { user } = useSignedInUser();
  const toast = useToast();
  const staff = useStaff();
  const [busy, setBusy] = useState(false);
  const owner = ownerOf(threadId);

  const update = async (patch: { status?: 'open' | 'resolved'; assignedTo?: string | null }) => {
    setBusy(true);
    try {
      await api.support.update(threadId, patch);
    } catch (error) {
      toast.error("Couldn't update the conversation", describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/support"
          className="text-slate-400 hover:text-slate-700 lg:hidden"
          aria-label="All conversations"
        >
          <BackIcon size={18} aria-hidden />
        </Link>
        {owner.kind === 'store' ? (
          <StoreIcon size={18} className="text-amber-600" aria-hidden />
        ) : (
          <UserIcon size={18} className="text-slate-500" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">
            {thread?.ownerName ?? (owner.kind === 'store' ? owner.ownerId : 'Customer')}
          </p>
          <p className="truncate text-xs text-slate-500">
            {owner.kind === 'store'
              ? 'Store thread, shared by its team'
              : (thread?.companyName ?? 'Customer thread')}
          </p>
        </div>
      </div>
      {thread ? (
        <div className="flex items-center gap-2">
          <div className="w-44">
            <Select
              aria-label="Assigned to"
              value={thread.assignedTo ?? ''}
              disabled={busy}
              onChange={(event) => void update({ assignedTo: event.target.value || null })}
            >
              <option value="">Unassigned</option>
              <option value={user.uid}>Me</option>
              {staff.data
                .filter((member) => member.uid !== user.uid && member.status === 'active')
                .map((member) => (
                  <option key={member.uid} value={member.uid}>
                    {member.displayName}
                  </option>
                ))}
            </Select>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void update({ status: thread.status === 'open' ? 'resolved' : 'open' })}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {thread.status === 'open' ? 'Mark resolved' : 'Reopen'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidePanel({ threadId, now }: { threadId: string; now: number }) {
  const owner = ownerOf(threadId);
  const customer = owner.kind === 'customer';
  const orders = usePagedQuery(queries.opsOrders({ customerId: owner.ownerId }), { enabled: customer });
  const storeOrders = usePagedQuery(queries.opsStoreOrders({ storeId: owner.ownerId }), {
    enabled: !customer,
  });
  const issues = usePagedQuery(
    queries.opsIssues(
      customer
        ? { customerId: owner.ownerId, status: ['open', 'in_review'] }
        : { storeId: owner.ownerId, status: ['open', 'in_review'] },
    ),
  );
  const quotes = usePagedQuery(queries.opsQuotes({ customerId: owner.ownerId }), { enabled: customer });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={customer ? 'Recent orders' : 'Recent store orders'}
          action={
            customer ? null : (
              <Link
                to={`/stores/${encodeURIComponent(owner.ownerId)}`}
                className="text-xs font-semibold text-brand-600"
              >
                Store page
              </Link>
            )
          }
        />
        <CardBody>
          {customer ? (
            orders.items.length === 0 ? (
              <p className="text-sm text-slate-500">{orders.loading ? 'Loading…' : 'No orders yet.'}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {orders.items.slice(0, 5).map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-2">
                    <Link
                      to={`/orders/${encodeURIComponent(order.id)}`}
                      className="font-mono text-xs font-semibold hover:text-brand-700"
                    >
                      {order.number}
                    </Link>
                    <span className="text-xs text-slate-500">{formatMoney(order.current.totalCents)}</span>
                    <OrderStatusBadge status={order.status} />
                  </li>
                ))}
              </ul>
            )
          ) : storeOrders.items.length === 0 ? (
            <p className="text-sm text-slate-500">{storeOrders.loading ? 'Loading…' : 'No orders yet.'}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {storeOrders.items.slice(0, 5).map((so) => (
                <li key={so.id} className="flex items-center justify-between gap-2">
                  <Link
                    to={`/orders/${encodeURIComponent(so.orderId)}`}
                    className="font-mono text-xs font-semibold hover:text-brand-700"
                  >
                    {so.number}
                  </Link>
                  <span className="text-xs text-slate-500">{formatRelativeTime(so.createdAt, now)}</span>
                  <StoreOrderStatusBadge status={so.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Open issues" />
        <CardBody>
          {issues.items.length === 0 ? (
            <p className="text-sm text-slate-500">{issues.loading ? 'Loading…' : 'None open.'}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {issues.items.map((issue) => (
                <li key={issue.id}>
                  <Link to={`/issues/${encodeURIComponent(issue.id)}`} className="hover:text-brand-700">
                    <span className="font-mono text-xs font-semibold">{issue.number}</span> ·{' '}
                    {issue.storeOrderNumber}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {customer ? (
        <Card>
          <CardHeader title="Quotes" />
          <CardBody>
            {quotes.items.length === 0 ? (
              <p className="text-sm text-slate-500">{quotes.loading ? 'Loading…' : 'No material lists.'}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {quotes.items.slice(0, 5).map((quote) => (
                  <li key={quote.id} className="flex items-center justify-between gap-2">
                    <Link
                      to={`/quotes/${encodeURIComponent(quote.id)}`}
                      className="font-mono text-xs font-semibold hover:text-brand-700"
                    >
                      {quote.number}
                    </Link>
                    <Badge tone="neutral">{quote.status.replace('_', ' ')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function ThreadView({ threadId, now }: { threadId: string; now: number }) {
  const thread = useLiveQuery(queries.supportThread(threadId));
  const unread = thread.data?.unreadByStaff ?? 0;

  // Opening the thread reads it; a message arriving while it is open is read too.
  useEffect(() => {
    if (unread > 0) void api.support.markRead(threadId).catch(() => undefined);
  }, [threadId, unread]);

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="flex min-h-[32rem] flex-col overflow-hidden lg:h-[calc(100vh-14rem)]">
        <ThreadHeader threadId={threadId} thread={thread.data} />
        {thread.error && !thread.data ? (
          <ErrorState error={thread.error} onRetry={thread.retry} className="m-5" />
        ) : (
          <SupportConversation
            threadId={threadId}
            className="flex-1"
            emptyText="No messages yet. Your first message starts the conversation."
          />
        )}
      </Card>
      <SidePanel threadId={threadId} now={now} />
    </div>
  );
}

export default function SupportPage() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const now = useNow();
  const [kind, setKind] = useState<SupportThreadKind>(() =>
    threadId && ownerOf(threadId).kind === 'store' ? 'store' : 'customer',
  );
  const [status, setStatus] = useState<StatusFilter>('open');
  const threads = useLiveQuery(queries.supportThreads({ kind, status: status === 'all' ? null : status }));
  const unreadTotal = useOpsDashboard().data?.unreadSupport;

  const sorted = useMemo(
    () =>
      [...threads.data].sort(
        (a, b) =>
          Number(b.unreadByStaff > 0) - Number(a.unreadByStaff > 0) ||
          (b.lastMessage?.at ?? b.updatedAt) - (a.lastMessage?.at ?? a.updatedAt),
      ),
    [threads.data],
  );

  return (
    <>
      <PageHeader
        title="Support"
        description="Chats with customers and with stores. The oldest unread conversation comes first."
      />
      <div className={cn('grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]')}>
        <Card className={cn('overflow-hidden', threadId && 'hidden lg:block')}>
          <div className="space-y-3 border-b border-slate-100 px-4 pt-2 pb-3">
            <Tabs<SupportThreadKind>
              ariaLabel="Thread kind"
              value={kind}
              onChange={(value) => {
                setKind(value);
                if (threadId) navigate('/support');
              }}
              items={[
                {
                  value: 'customer',
                  label: 'Customers',
                  count: kind === 'customer' ? unreadTotal || undefined : undefined,
                },
                { value: 'store', label: 'Stores' },
              ]}
            />
            <Segmented<StatusFilter>
              ariaLabel="Conversation status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <div className="max-h-[calc(100vh-18rem)] overflow-y-auto">
            {threads.loading && threads.data.length === 0 ? (
              <PageSpinner label="Loading conversations" />
            ) : threads.error && threads.data.length === 0 ? (
              <ErrorState error={threads.error} onRetry={threads.retry} className="m-4" />
            ) : sorted.length === 0 ? (
              <ArtEmptyState
                artKey="scene-support"
                title="Inbox zero"
                description="No conversations here right now."
              />
            ) : (
              <ThreadList threads={sorted} selected={threadId} now={now} />
            )}
          </div>
        </Card>
        {threadId ? (
          <ThreadView key={threadId} threadId={threadId} now={now} />
        ) : (
          <Card className="hidden lg:block">
            <ArtEmptyState
              artKey="scene-support"
              title="Pick a conversation"
              description="Customers and store teams write from their apps and the supplier portal."
            />
          </Card>
        )}
      </div>
    </>
  );
}
