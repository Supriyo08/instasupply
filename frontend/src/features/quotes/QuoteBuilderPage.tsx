/**
 * `/quotes/:quoteId` (MARKETPLACE §9, §5.5.6; CLIENTS §4.5): the request beside the builder. Per request
 * line, search listings near the jobsite and add them to that store's group, or add a special-order
 * line; agreed unit prices; unmatched lines with reasons; fulfilment, receiving, window, labourer;
 * live totals from `priceCheckout`; validity (24/48/72 h); message; Send (`sendQuote` with the offer
 * version: `QUOTE_VERSION` reloads). The draft autosaves to the workspace 2 s after each change.
 */
import { useApiQuery, useLiveQuery } from '@instasupply/api-client/react';
import {
  formatDateTimeET,
  formatMoney,
  isFinalQuoteStatus,
  type Product,
  type Store,
  type WithId,
} from '@instasupply/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Field, TextArea } from '@/components/ui/Form';
import { CancelIcon, PlusIcon, QuoteIcon, SendIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { ActionDialog } from '@/features/orders/components/ActionDialog';
import { orderHref } from '@/features/orders/order-format';
import { api, call, describeError, errorCodeOf, isApiError, isNetworkError, queries } from '@/lib/api';

import { CustomLineForm } from './builder/CustomLineForm';
import {
  initialDraft,
  isFirstOrderOf,
  lineFromProduct,
  newerOfferVersion,
  parseDraft,
  pricingInputOf,
  priceDraft,
  sendRequestOf,
  type BuilderDraft,
} from './builder/draft';
import { ListingSearch } from './builder/ListingSearch';
import { OfferPanel } from './builder/OfferPanel';
import { RequestPanel } from './builder/RequestPanel';
import { AssignQuoteToMe, QuoteDeadline } from './QuotesPage';
import { QUOTE_STATUS_META } from './quote-format';

type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string };

const EDITABLE = new Set(['submitted', 'in_review', 'quoted', 'expired']);

function SaveIndicator({ save }: { save: SaveState }) {
  if (save.state === 'saving') return <span className="text-xs text-slate-500">Saving draft…</span>;
  if (save.state === 'saved')
    return <span className="text-xs text-slate-500">Draft saved {formatDateTimeET(save.at)}</span>;
  if (save.state === 'error')
    return <span className="text-xs font-medium text-rose-600">Draft not saved: {save.message}</span>;
  return null;
}

export default function QuoteBuilderPage() {
  const { quoteId } = useParams();
  const toast = useToast();
  const now = useServerNow(30_000);
  const quote = useLiveQuery(queries.quote(quoteId));
  const workspace = useApiQuery(queries.quoteWorkspace(quoteId));
  const storeList = useLiveQuery(queries.stores());
  const customer = useLiveQuery(queries.user(quote.data?.customerId));

  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [panel, setPanel] = useState<{ mode: 'search' | 'custom'; requestLine: number | null } | null>(null);
  const [save, setSave] = useState<SaveState>({ state: 'idle' });
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  // Lines whose agreed-price text does not parse yet (Send waits for them).
  const [badPrices, setBadPrices] = useState<ReadonlySet<string>>(() => new Set());
  const lastSaved = useRef<string | null>(null);

  // Start from the saved workspace once both reads answered; otherwise from the last offer or the request.
  if (draft === null && quote.data && !workspace.loading) {
    const saved = parseDraft(workspace.data, quote.data.offer?.version ?? 0);
    const start = saved ?? initialDraft(quote.data);
    lastSaved.current = JSON.stringify(start);
    setDraft(start);
  }

  const editable = !!quote.data && EDITABLE.has(quote.data.status);

  // Autosave 2 s after the last change (CLIENTS §4.5). The workspace is opaque JSON on the server.
  useEffect(() => {
    if (!draft || !quoteId || !editable) return;
    const json = JSON.stringify(draft);
    if (json === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      setSave({ state: 'saving' });
      api.quotes
        .saveWorkspace(quoteId, { ...draft })
        .then(() => {
          lastSaved.current = json;
          setSave({ state: 'saved', at: api.serverNow() });
        })
        .catch((error: unknown) => setSave({ state: 'error', message: describeError(error) }));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [draft, editable, quoteId]);

  const stores = useMemo(
    () => new Map<string, WithId<Store>>(storeList.data.map((store) => [store.id, store])),
    [storeList.data],
  );
  const catalogIds = useMemo(
    () => (draft?.lines ?? []).flatMap((line) => (line.kind === 'catalog' ? [line.productId] : [])),
    [draft?.lines],
  );
  const liveProducts = useLiveQuery(queries.productsByIds(catalogIds));
  const live = useMemo(
    () => new Map<string, Product>(liveProducts.data.map((product) => [product.id, product])),
    [liveProducts.data],
  );
  // Same default as the server's checkout context, which prices the offer on Send.
  const isFirstOrder = isFirstOrderOf(customer.data);

  const priced = useMemo(
    () =>
      draft && quote.data
        ? priceDraft(pricingInputOf(draft, quote.data, stores, live, isFirstOrder, now))
        : null,
    [draft, isFirstOrder, live, now, quote.data, stores],
  );

  if (quote.loading && !quote.data) return <PageSpinner label="Loading the material list" />;
  if (!quote.data) {
    if (quote.error) {
      return (
        <ErrorState
          error={quote.error}
          onRetry={quote.retry}
          title={isNetworkError(quote.error) ? "Can't reach the server" : "Couldn't load this list"}
        />
      );
    }
    return (
      <EmptyState
        icon={QuoteIcon}
        title="Material list not found"
        action={
          <Link to="/quotes" className="text-sm font-semibold text-brand-600">
            All quotes
          </Link>
        }
      />
    );
  }

  const data = quote.data;
  const status = QUOTE_STATUS_META[data.status];
  const requestTexts = data.request.lines.map((line) => line.text);
  const unanswered = data.request.lines.filter(
    (_, index) =>
      !(draft?.lines.some((line) => line.requestLine === index) ?? false) &&
      !(draft?.unmatched.some((item) => item.requestLine === index) ?? false),
  ).length;
  const newerVersion = draft ? newerOfferVersion(draft, data) : null;
  // The live totals are only what Send prices once the customer (first order) and the live products
  // (current list prices) have answered.
  const inputsReady = !customer.loading && !customer.error && !liveProducts.loading && !liveProducts.error;
  const priceTextBad = !!draft && draft.lines.some((line) => badPrices.has(line.key));
  const canSend =
    editable &&
    !!draft &&
    !!priced &&
    priced.canPlace &&
    newerVersion === null &&
    inputsReady &&
    !priceTextBad &&
    draft.lines.some((line) => line.quantity > 0) &&
    draft.lines.every((line) => stores.has(line.storeId)) &&
    !(draft.fulfilment === 'delivery' && !data.request.jobsite);
  const canClose = data.status === 'submitted' || data.status === 'in_review';
  const panelLine = panel?.requestLine ?? null;
  const panelRequest = panelLine !== null ? data.request.lines[panelLine] : undefined;

  const send = async () => {
    if (!draft) return;
    const request = sendRequestOf(draft, data, live);
    try {
      await call('sendQuote', request);
      // The draft now stands on the version just sent (the server sends expectedVersion + 1).
      const sent = request.expectedVersion + 1;
      setDraft((current) => (current ? { ...current, baseVersion: sent } : current));
      toast.success(`Quote ${data.number} sent`, 'The customer is notified in the app.');
    } catch (error) {
      if (errorCodeOf(error) === 'QUOTE_VERSION') {
        void api.cache.invalidate(['quote', data.id]);
        throw new Error(
          'Someone sent a newer offer while you were working, so nothing was sent. Load their version or keep your draft, then send again.',
          { cause: error },
        );
      }
      throw error;
    }
  };

  const setPriceValidity = (lineKey: string, valid: boolean) =>
    setBadPrices((current) => {
      if (current.has(lineKey) !== valid) return current;
      const next = new Set(current);
      if (valid) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });

  const sendHint = !editable
    ? undefined
    : newerVersion !== null
      ? `Version ${newerVersion} was sent after you started this draft.`
      : priceTextBad
        ? 'Fix the agreed prices first.'
        : customer.error || liveProducts.error
          ? "Couldn't load the customer or the live prices."
          : !inputsReady
            ? 'Loading the customer and the live prices…'
            : undefined;

  return (
    <>
      <PageHeader
        back={{ to: '/quotes', label: 'Quotes' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{data.number}</span>
            {data.companyName ?? data.customerName}
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Sent {formatDateTimeET(data.createdAt)}</span>
            <QuoteDeadline quote={data} />
            {data.assignedName ? <span>Assigned to {data.assignedName}</span> : null}
            {editable ? <SaveIndicator save={save} /> : null}
          </span>
        }
        actions={
          <>
            <AssignQuoteToMe quote={data} />
            {canClose ? (
              <Button variant="secondary" icon={CancelIcon} onClick={() => setClosing(true)}>
                Can't quote
              </Button>
            ) : null}
            {editable ? (
              <Button icon={SendIcon} disabled={!canSend} title={sendHint} onClick={() => setSending(true)}>
                {data.offer ? `Send version ${data.offer.version + 1}` : 'Send quote'}
              </Button>
            ) : null}
          </>
        }
      />

      {data.status === 'accepted' && data.orderId ? (
        <div className="mb-4">
          <Callout tone="success" icon={SuccessIcon} title="Accepted">
            The customer accepted version {data.offer?.version}.{' '}
            <Link to={orderHref(data.orderId)} className="font-semibold underline">
              Open the order
            </Link>
          </Callout>
        </div>
      ) : null}
      {editable && draft && newerVersion !== null && data.offer ? (
        <div className="mb-4">
          <Callout
            tone="warning"
            icon={WarningIcon}
            title={`Version ${newerVersion} was sent after you started`}
          >
            {data.offer.sentByName} sent it {formatDateTimeET(data.offer.sentAt)}. Your draft is built on{' '}
            {draft.baseVersion === 0 ? 'no offer' : `version ${draft.baseVersion}`}, so Send is held until you
            choose.
            <span className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  setDraft((current) =>
                    current ? { ...initialDraft(data), internalNote: current.internalNote } : current,
                  )
                }
              >
                Load version {newerVersion}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setDraft((current) => (current ? { ...current, baseVersion: newerVersion } : current))
                }
              >
                Keep my draft and replace it
              </Button>
            </span>
          </Callout>
        </div>
      ) : null}
      {editable && !canSend && sendHint && newerVersion === null ? (
        <p className="mb-4 text-xs text-slate-500">{sendHint}</p>
      ) : null}
      {isFinalQuoteStatus(data.status) && data.closeReason ? (
        <p className="mb-4 text-sm text-slate-600">Closed: {data.closeReason}</p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <RequestPanel
            quote={data}
            draft={draft}
            stores={stores}
            activeLine={panelLine}
            onFind={(requestLine) => setPanel({ mode: 'search', requestLine })}
          />
          {data.offerHistory.length > 0 ? (
            <Card>
              <CardHeader title="Offers sent" />
              <CardBody>
                <dl className="divide-y divide-slate-100">
                  {[...data.offerHistory].reverse().map((entry) => (
                    <DetailRow
                      key={entry.version}
                      label={`Version ${entry.version} · ${formatDateTimeET(entry.sentAt)}`}
                    >
                      {formatMoney(entry.totalCents)}
                    </DetailRow>
                  ))}
                </dl>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {!editable ? (
            data.offer ? (
              <Card>
                <CardHeader
                  title={`Version ${data.offer.version} as sent`}
                  description={`By ${data.offer.sentByName}, ${formatDateTimeET(data.offer.sentAt)}`}
                />
                <CardBody>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {data.offer.lines.map((line) => (
                      <li key={line.lineId} className="flex justify-between gap-3 py-2">
                        <span>
                          {line.quantity} × {line.name}
                          <span className="block text-xs text-slate-500">{line.storeName}</span>
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(line.unitPriceCents * line.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-right text-base font-semibold">
                    {formatMoney(data.offer.pricing.totalCents)}
                  </p>
                </CardBody>
              </Card>
            ) : (
              <Callout tone="info" icon={QuoteIcon}>
                This list was closed before an offer was sent.
              </Callout>
            )
          ) : !draft || !priced ? (
            workspace.error && !draft ? (
              <ErrorState
                error={workspace.error}
                onRetry={workspace.retry}
                title="Couldn't load the saved draft"
              />
            ) : (
              <PageSpinner label="Loading the builder" />
            )
          ) : (
            <>
              {panel?.mode === 'search' ? (
                <ListingSearch
                  key={`search-${panelLine ?? 'extra'}`}
                  requestLine={panelLine}
                  initialText={panelRequest?.text ?? ''}
                  initialQuantity={panelRequest?.quantity ?? 1}
                  site={data.request.jobsite?.location ?? null}
                  stores={stores}
                  onAdd={(product, quantity) => {
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            lines: [...current.lines, lineFromProduct(product, panelLine, quantity)],
                            unmatched: current.unmatched.filter((item) => item.requestLine !== panelLine),
                          }
                        : current,
                    );
                    toast.success(`Added ${product.name}`, product.storeName);
                  }}
                  onUnmatched={(reason) => {
                    if (panelLine === null) return;
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            unmatched: [
                              ...current.unmatched.filter((item) => item.requestLine !== panelLine),
                              { requestLine: panelLine, reason },
                            ],
                          }
                        : current,
                    );
                    setPanel(null);
                  }}
                  onCustom={() => setPanel({ mode: 'custom', requestLine: panelLine })}
                  onClose={() => setPanel(null)}
                />
              ) : null}
              {panel?.mode === 'custom' ? (
                <CustomLineForm
                  requestLine={panelLine}
                  initialName={panelRequest?.text ?? ''}
                  initialQuantity={panelRequest?.quantity ?? 1}
                  onCancel={() => setPanel(null)}
                  onAdd={(line) => {
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            lines: [...current.lines, line],
                            unmatched: current.unmatched.filter((item) => item.requestLine !== panelLine),
                          }
                        : current,
                    );
                    setPanel(null);
                  }}
                />
              ) : null}
              {!panel ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={PlusIcon}
                    onClick={() => setPanel({ mode: 'search', requestLine: null })}
                  >
                    Add a listing
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={PlusIcon}
                    onClick={() => setPanel({ mode: 'custom', requestLine: null })}
                  >
                    Add a special order
                  </Button>
                </div>
              ) : null}
              {draft.unmatched.length > 0 ? (
                <Card>
                  <CardHeader title="Unmatched lines" description="Sent to the customer with the reason." />
                  <ul className="divide-y divide-slate-100">
                    {draft.unmatched.map((item) => (
                      <li
                        key={item.requestLine}
                        className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm"
                      >
                        <span>
                          <span className="font-medium">
                            {item.requestLine + 1}. {requestTexts[item.requestLine]}
                          </span>
                          <span className="block text-xs text-slate-500">{item.reason}</span>
                        </span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand-600"
                          onClick={() =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    unmatched: current.unmatched.filter(
                                      (other) => other.requestLine !== item.requestLine,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          Undo
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              <OfferPanel
                draft={draft}
                setDraft={setDraft}
                priced={priced}
                live={live}
                stores={stores}
                requestTexts={requestTexts}
                hasJobsite={!!data.request.jobsite}
                now={now}
                onPriceValidity={setPriceValidity}
              />
            </>
          )}
        </div>
      </div>

      {sending && priced && draft ? (
        <ActionDialog
          open
          onClose={() => setSending(false)}
          title={`Send ${data.number} to ${data.customerName}?`}
          description={`${formatMoney(priced.totalCents)} including HST, valid for ${draft.validHours} hours. The customer gets a notification and can accept it in the app.`}
          confirmLabel="Send quote"
          onConfirm={send}
          explainError={(error) =>
            !isApiError(error) && error instanceof Error ? error.message : describeError(error)
          }
        >
          {unanswered > 0 ? (
            <Callout tone="warning" icon={WarningIcon}>
              {unanswered} request {unanswered === 1 ? 'line has' : 'lines have'} no match and no reason yet.
            </Callout>
          ) : null}
        </ActionDialog>
      ) : null}

      {closing ? (
        <ActionDialog
          open
          tone="danger"
          onClose={() => setClosing(false)}
          title={`Close ${data.number} without a quote?`}
          description="The customer is told we couldn't source the list, with your reason."
          confirmLabel="Close list"
          confirmDisabled={closeReason.trim().length < 3}
          onConfirm={async () => {
            await call('closeQuote', { quoteId: data.id, reason: closeReason.trim() });
            toast.success(`${data.number} closed`);
          }}
        >
          <Field label="Reason" required>
            {(id) => (
              <TextArea
                id={id}
                value={closeReason}
                maxLength={500}
                placeholder="None of our stores in range carry 24 ft glulam beams."
                onChange={(event) => setCloseReason(event.target.value)}
              />
            )}
          </Field>
        </ActionDialog>
      ) : null}
    </>
  );
}
