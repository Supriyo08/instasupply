/**
 * `/issues/:issueId` (MARKETPLACE §9, §5.5.7; CLIENTS §4.5): the customer's photos and lines, the
 * store order, the delivery proof photo, the store's response through the store support thread, and
 * the resolution form: kind; the refund calculator (`refundForLines` from shared, defaulting to the
 * reported lines; delivery fee optional); return required; fault party; note. Internal notes are
 * staff only. The server computes the real refund and enforces the $100 dispatcher cap (REFUND_LIMIT).
 */
import { useApiQuery, useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  DISPATCHER_REFUND_LIMIT_CENTS,
  formatDateTimeET,
  formatMoney,
  refundForLines,
  refundableCents,
  type Amounts,
  type FaultParty,
  type Issue,
  type RefundRequest,
  type StoreOrder,
} from '@instasupply/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Field, Select, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { ErrorIcon, IssueIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { SignedImage } from '@/features/files/SignedImage';
import { ItemThumb } from '@/features/orders/components/ItemThumb';
import { StoreOrderStatusBadge } from '@/features/orders/components/OrderBadges';
import { orderHref } from '@/features/orders/order-format';
import { SupportConversation } from '@/features/support/SupportConversation';
import { api, call, describeError, isNetworkError, queries } from '@/lib/api';

import { AssignToMe, IssueSla } from './IssuesPage';
import {
  FAULT_PARTIES,
  ISSUE_STATUS_META,
  ISSUE_TYPE_LABELS,
  PREFERRED_LABELS,
  RESOLUTION_LABELS,
} from './issue-format';

type Kind = 'refund' | 'replacement' | 'no_action';

function AmountsList({ amounts }: { amounts: Amounts }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      <DetailRow label="Items">{formatMoney(amounts.itemsCents)}</DetailRow>
      {amounts.discountCents > 0 ? (
        <DetailRow label="Discount share">−{formatMoney(amounts.discountCents)}</DetailRow>
      ) : null}
      {amounts.deliveryFeeCents > 0 ? (
        <DetailRow label="Delivery fee">{formatMoney(amounts.deliveryFeeCents)}</DetailRow>
      ) : null}
      {amounts.unloadFeeCents > 0 ? (
        <DetailRow label="Labourer">{formatMoney(amounts.unloadFeeCents)}</DetailRow>
      ) : null}
      <DetailRow label="HST">{formatMoney(amounts.taxCents)}</DetailRow>
      <DetailRow label="Refund">
        <span className="text-base font-semibold">{formatMoney(amounts.totalCents)}</span>
      </DetailRow>
    </dl>
  );
}

function ResolutionForm({ issue, storeOrder }: { issue: Issue; storeOrder: StoreOrder }) {
  const { role } = useSignedInUser();
  const toast = useToast();
  const order = useLiveQuery(queries.order(issue.orderId));
  const siblings = usePagedQuery(queries.opsIssues({ storeOrderId: issue.storeOrderId }));
  const [kind, setKind] = useState<Kind>(
    issue.preferredResolution === 'replacement' ? 'replacement' : 'refund',
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(issue.lines.map((line) => [line.lineId, line.quantity])),
  );
  const [includeDeliveryFee, setIncludeDeliveryFee] = useState(issue.type === 'late');
  const [returnRequired, setReturnRequired] = useState(issue.preferredResolution === 'return');
  const [faultParty, setFaultParty] = useState<FaultParty | ''>('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ refundCents: number; replacementOrderId: string | null } | null>(
    null,
  );

  // The preview needs every earlier case on this store order, so all pages are loaded before it is
  // trusted (the list is short: one store order's cases).
  const { hasMore, loading: siblingsLoading, loadingMore, error: siblingsError, loadMore } = siblings;
  useEffect(() => {
    if (!siblingsLoading && !loadingMore && !siblingsError && hasMore) loadMore();
  }, [hasMore, loadMore, loadingMore, siblingsError, siblingsLoading]);
  const siblingsReady = !siblingsLoading && !loadingMore && !hasMore && !siblingsError;

  const lines = storeOrder.lines
    .map((line) => ({ lineId: line.lineId, quantity: quantities[line.lineId] ?? 0 }))
    .filter((line) => line.quantity > 0);

  // Refunds already granted on this store order (its other resolved refund cases), so the preview
  // never refunds a unit or the fees twice. The server prices the real refund.
  const earlierRefunds: RefundRequest[] = useMemo(
    () =>
      siblings.items
        .filter((other) => other.id !== issue.id && other.resolution?.kind === 'refund')
        .map((other) => ({
          lines: other.lines.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
          includeDeliveryFee: other.resolution?.refundDeliveryFee ?? false,
        })),
    [issue.id, siblings.items],
  );

  const preview = useMemo((): { amounts: Amounts; cappedCents: number | null } | { error: string } => {
    if (kind !== 'refund')
      return { amounts: refundForLines(storeOrder, [], { includeDeliveryFee: false }), cappedCents: null };
    try {
      const amounts = refundForLines(storeOrder, lines, { includeDeliveryFee, earlierRefunds });
      const payment = order.data?.payment;
      const captured = payment && payment.capturedCents > 0;
      const cappedCents = captured
        ? Math.min(amounts.totalCents, refundableCents(storeOrder, payment))
        : null;
      return { amounts, cappedCents };
    } catch (caught) {
      return {
        error:
          caught instanceof Error ? caught.message.replace(/^refundForLines: /, '') : 'Check the quantities.',
      };
    }
  }, [earlierRefunds, includeDeliveryFee, kind, lines, order.data?.payment, storeOrder]);

  const refundTotal = 'amounts' in preview ? (preview.cappedCents ?? preview.amounts.totalCents) : 0;
  const overLimit = kind === 'refund' && role === 'dispatcher' && refundTotal > DISPATCHER_REFUND_LIMIT_CENTS;
  const refundPending = kind === 'refund' && !siblingsReady;
  const invalid =
    refundPending ||
    note.trim().length < 3 ||
    'error' in preview ||
    (kind === 'refund' && refundTotal <= 0) ||
    (kind === 'replacement' && lines.length === 0);

  if (result) {
    return (
      <Callout tone="success" icon={SuccessIcon} title="Case resolved">
        {result.refundCents > 0 ? `${formatMoney(result.refundCents)} refunded to the customer. ` : ''}
        {result.replacementOrderId ? (
          <Link to={orderHref(result.replacementOrderId)} className="font-semibold underline">
            Open the replacement order
          </Link>
        ) : null}
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Resolution</legend>
        {(['refund', 'replacement', 'no_action'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm text-slate-800">
            <input type="radio" name="resolution" checked={kind === value} onChange={() => setKind(value)} />
            {RESOLUTION_LABELS[value]}
            {value === 'replacement' ? (
              <span className="text-xs text-slate-500">· same store and jobsite, at no charge</span>
            ) : null}
          </label>
        ))}
      </fieldset>

      {kind !== 'no_action' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Lines</p>
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {storeOrder.lines.map((line) => (
              <li key={line.lineId} className="flex items-center gap-3 px-3 py-2">
                <ItemThumb item={line} size="sm" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium text-slate-900">{line.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatMoney(line.unitPriceCents)} · {line.fulfilledQty} supplied
                  </p>
                </div>
                <TextInput
                  type="number"
                  min={0}
                  max={line.fulfilledQty}
                  value={quantities[line.lineId] ?? 0}
                  aria-label={`Units of ${line.name}`}
                  className="w-20"
                  onChange={(event) => {
                    const value = Math.max(
                      0,
                      Math.min(line.fulfilledQty, Math.floor(Number(event.target.value) || 0)),
                    );
                    setQuantities((current) => ({ ...current, [line.lineId]: value }));
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {kind === 'refund' ? (
        <>
          <Toggle
            checked={includeDeliveryFee}
            onChange={setIncludeDeliveryFee}
            label="Refund the delivery and labourer fees"
            description="Typically for a late delivery, or when the whole store order comes back."
          />
          <Card className="bg-slate-50/60 shadow-none">
            <CardBody>
              {siblingsError ? (
                <div className="space-y-2 text-sm text-rose-700">
                  <p>
                    Couldn&apos;t load the earlier cases on this store order, so the refund can&apos;t be
                    worked out yet: {describeError(siblingsError)}
                  </p>
                  <Button size="sm" variant="secondary" onClick={hasMore ? loadMore : siblings.retry}>
                    Try again
                  </Button>
                </div>
              ) : !siblingsReady ? (
                <p className="text-sm text-slate-500">Checking earlier refunds on this store order…</p>
              ) : 'error' in preview ? (
                <p className="text-sm text-rose-700">{preview.error}</p>
              ) : (
                <>
                  <AmountsList amounts={preview.amounts} />
                  {preview.cappedCents !== null && preview.cappedCents < preview.amounts.totalCents ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Only {formatMoney(preview.cappedCents)} is left to refund on this store order.
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-500">
                    {order.data && order.data.payment.capturedCents > 0
                      ? 'The card was charged: this goes back to the card.'
                      : 'Not charged yet: the customer is simply charged less.'}
                  </p>
                </>
              )}
            </CardBody>
          </Card>
          {overLimit ? (
            <Callout tone="warning" icon={WarningIcon}>
              Dispatchers can refund up to {formatMoney(DISPATCHER_REFUND_LIMIT_CENTS)}. Ask an admin to
              resolve this case.
            </Callout>
          ) : null}
        </>
      ) : null}

      <Toggle
        checked={returnRequired}
        onChange={setReturnRequired}
        label="The customer must return the items"
      />
      <Field label="Who is at fault" hint={FAULT_PARTIES.find((party) => party.id === faultParty)?.hint}>
        {(id, describedBy) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={faultParty}
            onChange={(event) => setFaultParty(event.target.value as FaultParty | '')}
          >
            <option value="">Not decided</option>
            {FAULT_PARTIES.map((party) => (
              <option key={party.id} value={party.id}>
                {party.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Note to the customer and the store" required>
        {(id) => (
          <TextArea id={id} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
        )}
      </Field>
      <Button className="w-full" disabled={invalid || overLimit} onClick={() => setConfirming(true)}>
        {kind === 'refund'
          ? refundPending
            ? 'Refund'
            : `Refund ${formatMoney(refundTotal)}`
          : kind === 'replacement'
            ? 'Send a replacement'
            : 'Close with no action'}
      </Button>

      {confirming ? (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          title={`Resolve ${issue.number}?`}
          description={
            kind === 'refund'
              ? `${formatMoney(refundTotal)} goes back to ${issue.customerName}. The customer and the store are notified.`
              : kind === 'replacement'
                ? `A new order for ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} goes to ${issue.storeName} at no charge.`
                : 'The case closes with your note. The customer and the store are notified.'
          }
          confirmLabel="Resolve case"
          onConfirm={async () => {
            // A dispatcher over the cap gets REFUND_LIMIT, whose message explains the $100 limit.
            const response = await call('resolveIssue', {
              issueId: issue.id,
              kind,
              lines: kind === 'no_action' ? undefined : lines,
              refundDeliveryFee: kind === 'refund' ? includeDeliveryFee : undefined,
              returnRequired,
              faultParty: faultParty || null,
              note: note.trim(),
            });
            setResult(response);
            toast.success(`${issue.number} resolved`);
          }}
        />
      ) : null}
    </div>
  );
}

function ResolutionSummary({ issue }: { issue: Issue }) {
  const resolution = issue.resolution;
  if (!resolution) return null;
  return (
    <dl className="divide-y divide-slate-100">
      <DetailRow label="Resolution">{RESOLUTION_LABELS[resolution.kind]}</DetailRow>
      {resolution.refundCents > 0 ? (
        <DetailRow label="Refunded">{formatMoney(resolution.refundCents)}</DetailRow>
      ) : null}
      {resolution.refundDeliveryFee ? <DetailRow label="Fees">Refunded</DetailRow> : null}
      <DetailRow label="Return">{resolution.returnRequired ? 'Required' : 'Not required'}</DetailRow>
      <DetailRow label="At fault">
        {FAULT_PARTIES.find((party) => party.id === resolution.faultParty)?.label ?? 'Not decided'}
      </DetailRow>
      {resolution.replacementOrderId ? (
        <DetailRow label="Replacement">
          <Link to={orderHref(resolution.replacementOrderId)} className="text-brand-700 hover:underline">
            Open order
          </Link>
        </DetailRow>
      ) : null}
      <DetailRow label="By">
        {resolution.resolvedByName} · {formatDateTimeET(resolution.resolvedAt)}
      </DetailRow>
      <div className="py-2 text-sm text-slate-700">{resolution.note}</div>
    </dl>
  );
}

function NotesCard({ issueId }: { issueId: string }) {
  const notes = useApiQuery(queries.issueNotes(issueId));
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? notes.data?.notes ?? '';

  return (
    <Card>
      <CardHeader
        title="Internal notes"
        description="Staff only. Never shown to the customer or the store."
      />
      <CardBody className="space-y-3">
        <TextArea
          aria-label="Internal notes"
          value={value}
          maxLength={5000}
          onChange={(event) => setDraft(event.target.value)}
          disabled={notes.loading && !notes.data}
        />
        {notes.data ? (
          <p className="text-xs text-slate-500">Last saved {formatDateTimeET(notes.data.updatedAt)}</p>
        ) : null}
        {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={draft === null}
          onClick={() => {
            setBusy(true);
            setError(null);
            api.issues
              .saveNotes(issueId, value)
              .then(() => setDraft(null))
              .catch((caught: unknown) => setError(describeError(caught)))
              .finally(() => setBusy(false));
          }}
        >
          Save notes
        </Button>
      </CardBody>
    </Card>
  );
}

function ProofCard({ deliveryId }: { deliveryId: string }) {
  const delivery = useLiveQuery(queries.delivery(deliveryId));
  const proof = delivery.data?.proof;
  return (
    <Card>
      <CardHeader
        title="Delivery proof"
        action={
          <Link
            to={`/deliveries/${encodeURIComponent(deliveryId)}`}
            className="text-xs font-semibold text-brand-600"
          >
            Open delivery
          </Link>
        }
      />
      <CardBody className="space-y-3">
        {delivery.loading && !delivery.data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !proof ? (
          <p className="text-sm text-slate-500">No proof was recorded.</p>
        ) : (
          <>
            {proof.photoPath ? (
              <SignedImage
                path={proof.photoPath}
                alt="Drop-off photo taken by the driver"
                className="w-full rounded-xl object-cover"
              />
            ) : null}
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Received by">{proof.recipientName ?? '—'}</DetailRow>
              <DetailRow label="Hand-off code">{proof.codeVerified ? 'Verified' : 'Not used'}</DetailRow>
              {delivery.data?.deliveredAt ? (
                <DetailRow label="Delivered">{formatDateTimeET(delivery.data.deliveredAt)}</DetailRow>
              ) : null}
              {proof.note ? <DetailRow label="Driver note">{proof.note}</DetailRow> : null}
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function IssueDetailPage() {
  const { issueId } = useParams();
  const issue = useLiveQuery(queries.issue(issueId));
  const storeOrder = useLiveQuery(queries.storeOrder(issue.data?.storeOrderId));

  if (issue.loading && !issue.data) return <PageSpinner label="Loading case" />;
  if (!issue.data) {
    if (issue.error) {
      return (
        <ErrorState
          error={issue.error}
          onRetry={issue.retry}
          title={isNetworkError(issue.error) ? "Can't reach the server" : "Couldn't load this case"}
        />
      );
    }
    return (
      <EmptyState
        icon={IssueIcon}
        title="Case not found"
        action={
          <Link to="/issues" className="text-sm font-semibold text-brand-600">
            All issues
          </Link>
        }
      />
    );
  }

  const data = issue.data;
  const status = ISSUE_STATUS_META[data.status];
  const so = storeOrder.data;

  return (
    <>
      <PageHeader
        back={{ to: '/issues', label: 'Issues' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{data.number}</span>
            {ISSUE_TYPE_LABELS[data.type]}
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {data.customerName} · {data.storeName} ·{' '}
              <Link to={orderHref(data.orderId)} className="text-brand-700 hover:underline">
                {data.storeOrderNumber}
              </Link>
            </span>
            <span>Reported {formatDateTimeET(data.createdAt)}</span>
            <IssueSla issue={data} />
          </span>
        }
        actions={
          <>
            {data.assignedName ? (
              <span className="text-sm text-slate-500">Assigned to {data.assignedName}</span>
            ) : null}
            <AssignToMe issue={data} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="What the customer reported"
              description={PREFERRED_LABELS[data.preferredResolution]}
            />
            <CardBody className="space-y-4">
              <p className="text-sm whitespace-pre-wrap text-slate-800">{data.description}</p>
              {data.photoPaths.length > 0 ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos from the customer">
                  {data.photoPaths.map((path, index) => (
                    <li key={path}>
                      <SignedImage
                        path={path}
                        alt={`Customer photo ${index + 1}`}
                        className="aspect-square w-full rounded-xl object-cover"
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No photos.</p>
              )}
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Affected lines</caption>
                <thead className="border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 font-medium">
                      Item
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Affected
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Unit price
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.lines.map((line) => (
                    <tr key={line.lineId}>
                      <td className="py-2">{line.name}</td>
                      <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(line.unitPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Store order"
              action={
                <Link to={orderHref(data.orderId)} className="text-xs font-semibold text-brand-600">
                  Open order
                </Link>
              }
            />
            <CardBody>
              {so ? (
                <dl className="divide-y divide-slate-100">
                  <DetailRow label="Number">{so.number}</DetailRow>
                  <DetailRow label="Status">
                    <StoreOrderStatusBadge status={so.status} />
                  </DetailRow>
                  <DetailRow label="Store">{so.storeName}</DetailRow>
                  <DetailRow label="Completed">
                    {so.completedAt ? formatDateTimeET(so.completedAt) : '—'}
                  </DetailRow>
                  <DetailRow label="Total">{formatMoney(so.current.totalCents)}</DetailRow>
                </dl>
              ) : storeOrder.error ? (
                <ErrorState error={storeOrder.error} onRetry={storeOrder.retry} />
              ) : (
                <p className="text-sm text-slate-500">Loading…</p>
              )}
            </CardBody>
          </Card>

          {data.deliveryId ? <ProofCard deliveryId={data.deliveryId} /> : null}

          <Card className="flex h-[28rem] flex-col overflow-hidden">
            <CardHeader
              title={`Store response · ${data.storeName}`}
              description="The store's support thread. Messages sent here are tagged with this case."
              action={
                <Link
                  to={`/support/store_${encodeURIComponent(data.storeId)}`}
                  className="text-xs font-semibold text-brand-600"
                >
                  Open thread
                </Link>
              }
            />
            <SupportConversation
              threadId={`store_${data.storeId}`}
              context={{ kind: 'issue', id: data.id, label: data.number }}
              className="flex-1"
              emptyText={`Ask ${data.storeName} for their side of it.`}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={data.status === 'resolved' ? 'Resolution' : 'Resolve the case'} />
            <CardBody>
              {data.status === 'resolved' ? (
                <ResolutionSummary issue={data} />
              ) : so ? (
                <ResolutionForm issue={data} storeOrder={so} />
              ) : storeOrder.error ? (
                <Callout tone="danger" icon={ErrorIcon}>
                  {describeError(storeOrder.error)}
                </Callout>
              ) : (
                <p className="text-sm text-slate-500">Loading the store order…</p>
              )}
            </CardBody>
          </Card>
          <NotesCard issueId={data.id} />
        </div>
      </div>
    </>
  );
}
