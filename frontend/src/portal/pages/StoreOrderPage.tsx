import { useApiMutation, useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  STORE_ORDER_META,
  formatClockET,
  formatDateTimeET,
  formatPhone,
  pluralize,
  type IssueType,
  type LineAdjustment,
  type StoreOrder,
  type StoreRejectReason,
} from '@instasupply/shared';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { Countdown, useServerNow } from '@/components/ui/Countdown';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import {
  CarIcon,
  CheckIcon,
  ClockIcon,
  EditIcon,
  ErrorIcon,
  InfoIcon,
  IssueIcon,
  KeyIcon,
  MessageIcon,
  PhoneIcon,
  PlayIcon,
  ReceiptIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { useToast } from '@/components/ui/Toast';
import { useSupplier } from '@/features/auth/AuthProvider';
import { SignedImage } from '@/features/files/SignedImage';
import { api, describeError, detailsFor, errorCodeOf, isNetworkError, queries } from '@/lib/api';

import {
  customerLabel,
  driverChip,
  jobsiteArea,
  loadChip,
  promiseLabel,
  rejectReasonLabel,
} from '../components/order-format';
import { PickList, adjustmentsFrom, type ShortDraft, type ShortDrafts } from '../components/PickList';
import { actionSendsAdjustments } from '../components/short-ship';
import { PickSlip } from '../components/PickSlip';
import { PIN_LENGTH, PinPad } from '../components/PinPad';
import { ReasonDialog } from '../components/ReasonDialog';

type Action =
  | { kind: 'accept' }
  | { kind: 'status'; status: 'preparing' | 'ready' }
  | { kind: 'reject'; reason: Exclude<StoreRejectReason, 'no_response'>; note: string | null }
  | { kind: 'pickup'; code: string };

/** Statuses in which the store may still ship less than ordered (MARKETPLACE §2.1.1). */
const SHORTABLE = new Set<StoreOrder['status']>(['new', 'accepted', 'preparing', 'ready']);

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  missing_item: 'Missing item',
  short_quantity: 'Short quantity',
  late: 'Late',
  other: 'Other',
};

function successText(action: Action, order: StoreOrder): string {
  switch (action.kind) {
    case 'accept':
      return `Accepted ${order.number}`;
    case 'status':
      return action.status === 'preparing' ? `Picking ${order.number}` : `${order.number} is ready`;
    case 'reject':
      return order.status === 'new' ? `Rejected ${order.number}` : `Cancelled ${order.number}`;
    case 'pickup':
      return order.fulfilment === 'pickup' ? 'Picked up by the customer' : 'Load handed to the driver';
  }
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function CustomerCard({ order }: { order: StoreOrder }) {
  const area = jobsiteArea(order);
  const phone = order.siteContact?.phone ?? order.customerPhone;
  return (
    <SectionCard title={order.fulfilment === 'pickup' ? 'Pickup customer' : 'Customer and jobsite'}>
      <dl className="divide-y divide-slate-100">
        <DetailRow label="Customer">
          {order.customerName}
          {order.companyName ? (
            <span className="block text-xs text-slate-500">{order.companyName}</span>
          ) : null}
        </DetailRow>
        <DetailRow label="Phone">
          <a className="text-brand-700 hover:underline" href={`tel:${order.customerPhone}`}>
            {formatPhone(order.customerPhone)}
          </a>
        </DetailRow>
        {order.fulfilment === 'delivery' && order.jobsite ? (
          <>
            <DetailRow label="Jobsite">
              {order.jobsite.label}
              {area ? <span className="block text-xs text-slate-500">{order.jobsite.areaLabel}</span> : null}
            </DetailRow>
            {order.siteContact ? (
              <DetailRow label="Site contact">
                {order.siteContact.name}
                <a className="block text-xs text-brand-700 hover:underline" href={`tel:${phone}`}>
                  {formatPhone(phone)}
                </a>
              </DetailRow>
            ) : null}
            <DetailRow label="Receiving">
              {order.receiving === 'unattended'
                ? 'Unattended drop-off (photo proof)'
                : 'Someone on site signs for it'}
            </DetailRow>
          </>
        ) : null}
      </dl>
      {order.instructions ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <span className="font-medium text-slate-900">Instructions: </span>
          {order.instructions}
        </p>
      ) : null}
    </SectionCard>
  );
}

function DriverCard({ order }: { order: StoreOrder }) {
  if (order.fulfilment === 'pickup') return null;
  const driver = order.driver;
  return (
    <SectionCard title="Driver">
      {driver ? (
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <CarIcon size={18} aria-hidden />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-900">{driverChip(driver)}</p>
            {driver.phase === 'to_store' && driver.etaToStoreAt ? (
              <p className="text-slate-600">
                Expected at your counter around {formatClockET(driver.etaToStoreAt)}
              </p>
            ) : null}
            {driver.phase === 'at_store' && driver.arrivedAt ? (
              <p className="text-slate-600">
                At your counter since {formatClockET(driver.arrivedAt)}. Ask for their PIN.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          {order.status === 'new' || order.status === 'accepted'
            ? 'A driver claims the job after you accept. Their name, truck and plate show here.'
            : 'Waiting for a driver to claim the job. InstaSupply dispatch is watching it.'}
        </p>
      )}
    </SectionCard>
  );
}

function TimingCard({ order, now }: { order: StoreOrder; now: number }) {
  return (
    <SectionCard title="Timing">
      <dl className="divide-y divide-slate-100">
        <DetailRow label="Placed">{formatDateTimeET(order.createdAt, now)}</DetailRow>
        {order.status === 'new' ? (
          <DetailRow label="Accept by">
            {formatClockET(order.timing.respondBy)}
            <span className="block text-xs">
              <Countdown deadline={order.timing.respondBy} prefix="in" overdueLabel="Overdue by" />
            </span>
          </DetailRow>
        ) : null}
        <DetailRow label="Ready by">{formatDateTimeET(order.timing.readyBy, now)}</DetailRow>
        {order.timing.targetPickupAt ? (
          <DetailRow label="Driver pickup">{formatDateTimeET(order.timing.targetPickupAt, now)}</DetailRow>
        ) : null}
        <DetailRow label="Promise">{promiseLabel(order, now)}</DetailRow>
        {order.pickup.holdUntil ? (
          <DetailRow label="Held until">{formatDateTimeET(order.pickup.holdUntil, now)}</DetailRow>
        ) : null}
        <DetailRow label="Load">{loadChip(order)}</DetailRow>
      </dl>
    </SectionCard>
  );
}

function HistoryCard({ order, now }: { order: StoreOrder; now: number }) {
  const entries = [...order.history].reverse();
  return (
    <SectionCard title="History">
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing has happened yet.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-3 text-sm">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{STORE_ORDER_META[entry.status].label}</p>
                <p className="text-xs text-slate-500">
                  {formatDateTimeET(entry.at, now)}
                  {entry.actorName
                    ? ` · ${entry.actorName}`
                    : entry.actorRole === 'system'
                      ? ' · InstaSupply'
                      : ''}
                </p>
                {entry.note ? <p className="mt-0.5 text-slate-700">{entry.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

function IssuesCard({ storeId, order }: { storeId: string; order: StoreOrder }) {
  const issues = usePagedQuery(queries.storeIssues(storeId), { enabled: order.issueCount > 0 });
  if (order.issueCount === 0) return null;
  const mine = issues.items.filter((issue) => issue.storeOrderId === order.id);
  return (
    <SectionCard
      title="Reported issues"
      description="InstaSupply handles the customer. Reply through Support if they ask you about it."
    >
      {issues.loading && mine.length === 0 ? (
        <PageSpinner label="Loading issues" />
      ) : issues.error && mine.length === 0 ? (
        <ErrorState error={issues.error} onRetry={issues.retry} />
      ) : mine.length === 0 ? (
        <div className="text-sm text-slate-600">
          {issues.hasMore ? (
            <Button size="sm" variant="secondary" loading={issues.loadingMore} onClick={issues.loadMore}>
              Load older issues
            </Button>
          ) : (
            'The issue is no longer listed.'
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {mine.map((issue) => (
            <li key={issue.id} className="rounded-xl bg-rose-50/60 p-3 ring-1 ring-rose-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-slate-900">{issue.number}</span>
                <Badge tone="danger">{ISSUE_TYPE_LABELS[issue.type]}</Badge>
                <Badge tone={issue.status === 'resolved' ? 'success' : 'warning'}>
                  {issue.status === 'resolved'
                    ? 'Resolved'
                    : issue.status === 'in_review'
                      ? 'In review'
                      : 'Open'}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-slate-800">{issue.description}</p>
              {issue.lines.length > 0 ? (
                <p className="mt-1 text-xs text-slate-600">
                  {issue.lines.map((line) => `${line.quantity} × ${line.name}`).join(' · ')}
                </p>
              ) : null}
              {issue.photoPaths.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {issue.photoPaths.map((path, index) => (
                    <SignedImage
                      key={path}
                      path={path}
                      alt={`Photo ${index + 1} of ${issue.number}`}
                      className="aspect-square rounded-lg object-cover"
                    />
                  ))}
                </div>
              ) : null}
              {issue.resolution ? (
                <p className="mt-2 text-xs text-slate-600">
                  Resolution: {issue.resolution.note || issue.resolution.kind}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PinDialog({
  open,
  onClose,
  order,
  busy,
  error,
  remaining,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  order: StoreOrder;
  busy: boolean;
  error: string | null;
  remaining: number | null;
  onConfirm: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const who = order.fulfilment === 'pickup' ? 'the customer' : (order.driver?.firstName ?? 'the driver');
  const submit = () => {
    if (code.length === PIN_LENGTH) onConfirm(code);
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnBackdrop={false}
      size="sm"
      title="Confirm collection"
      description={`Ask ${who} for the 4-digit PIN in their InstaSupply app and type it here.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button icon={CheckIcon} loading={busy} disabled={code.length !== PIN_LENGTH} onClick={submit}>
            {order.fulfilment === 'pickup' ? 'Hand over the order' : 'Load leaves with driver'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <PinPad value={code} onChange={setCode} onSubmit={submit} disabled={busy} label="Collection PIN" />
        {remaining !== null ? (
          <p className="text-center text-sm font-medium text-amber-700" role="status">
            {remaining > 0
              ? `That PIN didn't match. ${pluralize(remaining, 'attempt')} left.`
              : 'No attempts left. Call InstaSupply support to release the order.'}
          </p>
        ) : null}
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

function OrderView({ order, storeId }: { order: StoreOrder; storeId: string }) {
  const toast = useToast();
  const now = useServerNow(30_000);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<ShortDrafts>({});
  const [dialog, setDialog] = useState<'reject' | 'cancel' | 'pin' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pinSession, setPinSession] = useState(0);
  const [running, setRunning] = useState<Action['kind'] | 'preparing' | 'ready' | null>(null);

  const status = order.status;
  const canShort = SHORTABLE.has(status);
  const shortage = adjustmentsFrom(order.lines, canShort ? drafts : {});
  const hasErrors = Object.keys(shortage.errors).length > 0;

  const mutation = useApiMutation(
    async (client, input: { action: Action; adjustments: LineAdjustment[] }) => {
      const base = { storeOrderId: order.id, expectedVersion: order.version };
      const adjustments = input.adjustments.length > 0 ? input.adjustments : undefined;
      const { action } = input;
      switch (action.kind) {
        case 'accept':
          return client.call('acceptStoreOrder', { ...base, adjustments });
        case 'status':
          return client.call('updateStoreOrderStatus', {
            ...base,
            status: action.status,
            adjustments: actionSendsAdjustments(action) ? adjustments : undefined,
          });
        case 'reject':
          return client.call('rejectStoreOrder', { ...base, reason: action.reason, note: action.note });
        case 'pickup':
          return client.call('completePickup', { ...base, pickupCode: action.code, adjustments });
      }
    },
  );

  const run = async (action: Action, inDialog: boolean) => {
    const sendsShortages = actionSendsAdjustments(action);
    if (hasErrors && sendsShortages) {
      setError('Fix the quantities in the pick list first.');
      setEditing(true);
      return;
    }
    setError(null);
    setDialogError(null);
    setRunning(action.kind === 'status' ? action.status : action.kind);
    try {
      await mutation.run({ action, adjustments: shortage.adjustments });
      toast.success(successText(action, order));
      // Quantities not sent with this action stay for the next one that sends them (Mark ready).
      if (sendsShortages || shortage.adjustments.length === 0) {
        setDrafts({});
        setEditing(false);
      }
      setDialog(null);
      setRemaining(null);
    } catch (caught) {
      const code = errorCodeOf(caught);
      let message = describeError(caught);
      if (code === 'VERSION_CONFLICT') {
        void api.cache.invalidate(['store-order', order.id]);
        message = 'This order changed while you had it open, so nothing was saved. Check it and try again.';
      } else if (code === 'CODE_INCORRECT') {
        setRemaining(detailsFor(caught, 'CODE_INCORRECT')?.remaining ?? null);
        message = '';
      } else if (code === 'CODE_LOCKED') {
        setRemaining(0);
        message = 'Too many wrong PINs. Only InstaSupply support can complete this hand-over now.';
      } else if (isNetworkError(caught)) {
        message = `${message} The order may have been updated: it refreshes when you're back online.`;
      }
      if (inDialog) setDialogError(message || null);
      else setError(message);
    } finally {
      setRunning(null);
    }
  };

  const busy = mutation.busy;
  const meta = STORE_ORDER_META[status];
  const shortCount = shortage.adjustments.length;
  const nextWithShortage =
    status === 'new' ? 'Accept' : status === 'ready' ? 'Confirm collection' : 'Mark ready';

  const actions: ReactNode = (() => {
    switch (status) {
      case 'new':
        return (
          <>
            <Button
              size="lg"
              icon={CheckIcon}
              loading={running === 'accept'}
              disabled={busy}
              onClick={() => void run({ kind: 'accept' }, false)}
            >
              {shortCount > 0 ? `Accept with ${pluralize(shortCount, 'short line')}` : 'Accept order'}
            </Button>
            <Button size="lg" variant="secondary" disabled={busy} onClick={() => setDialog('reject')}>
              Reject
            </Button>
          </>
        );
      case 'accepted':
        return (
          <>
            <Button
              size="lg"
              icon={PlayIcon}
              loading={running === 'preparing'}
              disabled={busy}
              onClick={() => void run({ kind: 'status', status: 'preparing' }, false)}
            >
              Start preparing
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={CheckIcon}
              loading={running === 'ready'}
              disabled={busy}
              onClick={() => void run({ kind: 'status', status: 'ready' }, false)}
            >
              {shortCount > 0 ? `Mark ready with ${pluralize(shortCount, 'short line')}` : 'Mark ready'}
            </Button>
          </>
        );
      case 'preparing':
        return (
          <Button
            size="lg"
            icon={CheckIcon}
            loading={running === 'ready'}
            disabled={busy}
            onClick={() => void run({ kind: 'status', status: 'ready' }, false)}
          >
            {shortCount > 0 ? `Mark ready with ${pluralize(shortCount, 'short line')}` : 'Mark ready'}
          </Button>
        );
      case 'ready':
        return (
          <>
            <Button
              size="lg"
              icon={KeyIcon}
              disabled={busy}
              onClick={() => {
                setRemaining(null);
                setDialogError(null);
                setPinSession((value) => value + 1);
                setDialog('pin');
              }}
            >
              Confirm collection
            </Button>
            <Button
              size="lg"
              variant="secondary"
              loading={running === 'preparing'}
              disabled={busy}
              onClick={() => void run({ kind: 'status', status: 'preparing' }, false)}
            >
              Not ready after all
            </Button>
          </>
        );
      default:
        return null;
    }
  })();

  const canCancel = status === 'accepted' || status === 'preparing' || status === 'ready';
  const blocked = status === 'ready' && order.fulfilment === 'delivery' && !order.driver;

  return (
    <>
      <PageHeader
        back={{ to: '/portal', label: 'Orders' }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{order.number}</span>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
            <Badge tone={order.fulfilment === 'pickup' ? 'info' : 'brand'}>
              {order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}
            </Badge>
          </span>
        }
        description={`${customerLabel(order)} · ${promiseLabel(order, now)} · ${pluralize(order.itemCount, 'item')}`}
        actions={
          <>
            <Button variant="secondary" icon={ReceiptIcon} onClick={() => window.print()}>
              Print pick slip
            </Button>
            <Link
              to={`/portal/support?about=${encodeURIComponent(order.id)}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <MessageIcon size={16} aria-hidden /> Ask InstaSupply
            </Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {actions || canCancel ? (
            <Card>
              <CardBody className="space-y-3">
                {status === 'new' ? (
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <ClockIcon size={16} aria-hidden className="text-amber-600" />
                    <Countdown
                      deadline={order.timing.respondBy}
                      prefix="Accept within"
                      overdueLabel="Overdue by"
                    />
                    <span className="text-slate-500">· unanswered orders are rejected 20 min after that</span>
                  </p>
                ) : null}
                {blocked ? (
                  <Callout tone="info" icon={InfoIcon}>
                    No driver has claimed this job yet. Keep the load at the counter; you confirm the
                    hand-over with the driver&apos;s PIN.
                  </Callout>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  {actions}
                  {canShort && status !== 'out_for_delivery' ? (
                    <Button
                      variant={editing ? 'subtle' : 'ghost'}
                      icon={EditIcon}
                      disabled={busy}
                      aria-pressed={editing}
                      onClick={() => setEditing((value) => !value)}
                    >
                      {editing ? 'Done editing quantities' : 'Ship short'}
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      disabled={busy}
                      onClick={() => setDialog('cancel')}
                    >
                      Cancel order
                    </Button>
                  ) : null}
                </div>
                {shortCount > 0 ? (
                  <Callout tone="warning" icon={WarningIcon}>
                    {pluralize(shortCount, 'line')} will ship short. The new quantities are sent with{' '}
                    <strong>{nextWithShortage}</strong>
                    {status === 'accepted' ? ' (Start preparing keeps them for later)' : ''}; the customer is
                    only charged for what you ship.
                    {shortage.allZero
                      ? status === 'new'
                        ? ' Every line is at 0, so this rejects the order as out of stock.'
                        : ' Every line is at 0, so this cancels the order as out of stock.'
                      : ''}
                  </Callout>
                ) : null}
                {error ? (
                  <Callout tone="danger" icon={ErrorIcon}>
                    {error}
                  </Callout>
                ) : null}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-700">
                  {status === 'out_for_delivery'
                    ? 'On the way to the site. Nothing more to do here.'
                    : status === 'failed'
                      ? 'The delivery could not be completed. InstaSupply dispatch is sorting it out with the driver; you may be asked to take the load back.'
                      : status === 'rejected'
                        ? `Rejected${rejectReasonLabel(order.rejectReason) ? `: ${rejectReasonLabel(order.rejectReason)}` : ''}.`
                        : status === 'cancelled'
                          ? `Cancelled${order.cancelledBy ? ` by ${order.cancelledBy === 'store' ? 'your store' : order.cancelledBy === 'staff' ? 'InstaSupply' : order.cancelledBy === 'customer' ? 'the customer' : 'InstaSupply'}` : ''}${order.cancelReason ? `: ${order.cancelReason}` : ''}.`
                          : `Completed ${order.completedAt ? formatDateTimeET(order.completedAt, now) : ''}.`}
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Pick list"
              description={`${pluralize(order.lineCount, 'line')} · ${pluralize(order.itemCount, 'item')}`}
            />
            <PickList
              order={order}
              editing={editing && canShort}
              drafts={drafts}
              errors={shortage.errors}
              onChange={(lineId, draft: ShortDraft | null) =>
                setDrafts((current) => {
                  const next = { ...current };
                  if (draft) next[lineId] = draft;
                  else delete next[lineId];
                  return next;
                })
              }
            />
            <div className="flex flex-col items-end gap-1 border-t border-slate-100 px-5 py-3 text-sm">
              <p className="text-slate-600">
                Items <Money cents={order.current.itemsCents} className="ml-2 font-medium text-slate-900" />
              </p>
              <p className="font-semibold text-slate-900">
                Your sale <Money cents={order.storeValueCents} className="ml-2" />
              </p>
              <p className="text-xs text-slate-500">
                Paid out after the order is complete, less InstaSupply&apos;s commission.
              </p>
            </div>
          </Card>

          <IssuesCard storeId={storeId} order={order} />
        </div>

        <div className="space-y-6">
          <CustomerCard order={order} />
          <DriverCard order={order} />
          <TimingCard order={order} now={now} />
          <HistoryCard order={order} now={now} />
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <PhoneIcon size={12} aria-hidden /> Store line on file: {formatPhone(order.storePhone)}
          </p>
        </div>
      </div>

      <ReasonDialog
        key={`reason-${dialog}`}
        open={dialog === 'reject' || dialog === 'cancel'}
        mode={dialog === 'cancel' ? 'cancel' : 'reject'}
        orderNumber={order.number}
        busy={busy}
        error={dialogError}
        onClose={() => {
          setDialog(null);
          setDialogError(null);
        }}
        onConfirm={(reason, note) => void run({ kind: 'reject', reason, note }, true)}
      />
      <PinDialog
        key={`pin-${pinSession}`}
        open={dialog === 'pin'}
        order={order}
        busy={busy}
        error={dialogError}
        remaining={remaining}
        onClose={() => {
          setDialog(null);
          setDialogError(null);
        }}
        onConfirm={(code) => void run({ kind: 'pickup', code }, true)}
      />
      <PickSlip order={order} now={now} />
    </>
  );
}

/**
 * `/portal/orders/:storeOrderId` (MARKETPLACE §8, CLIENTS §4.4): the pick list with the short-ship
 * editor, the actions for the current status (all with `expectedVersion`), the PIN pad for the
 * hand-over, customer and jobsite, driver, history, issues and the printable pick slip.
 */
export default function StoreOrderPage() {
  const { storeOrderId } = useParams();
  const { storeId } = useSupplier();
  const query = useLiveQuery(queries.storeOrder(storeOrderId));
  const order = query.data;

  if (query.loading && !order) return <PageSpinner label="Loading order" />;
  if (query.error && !order) {
    return (
      <>
        <PageHeader back={{ to: '/portal', label: 'Orders' }} title="Order" />
        <ErrorState error={query.error} onRetry={query.retry} />
      </>
    );
  }
  if (!order || order.storeId !== storeId) {
    return (
      <>
        <PageHeader back={{ to: '/portal', label: 'Orders' }} title="Order not found" />
        <Card>
          <EmptyState
            icon={IssueIcon}
            title="We couldn't find this order"
            description="It may belong to another store, or the link is incomplete. Open it from the Orders board."
            action={
              <Link to="/portal" className="text-sm font-semibold text-brand-700 hover:underline">
                Back to Orders
              </Link>
            }
          />
        </Card>
      </>
    );
  }
  return <OrderView key={order.id} order={order} storeId={storeId} />;
}
