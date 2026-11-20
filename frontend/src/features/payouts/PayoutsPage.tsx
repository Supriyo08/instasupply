import { useConfig, useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import { formatDateTimeET, formatRelativeTime, type Payout } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadMore } from '@/components/ui/Data';
import { Callout, ErrorState, PageSpinner, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { ChevronDownIcon, ChevronRightIcon, PlayIcon, WarningIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { Money } from '@/components/ui/Money';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { SceneEmpty } from '@/features/deliveries/components/SceneArt';
import { call, queries, type WithId } from '@/lib/api';
import { useDrivers, useNow } from '@/lib/data';

import { LEDGER_KIND_LABEL, PAYOUT_PROVIDER_LABEL, PAYOUT_STATUS_META } from './ledger-format';

type PayeeFilter = 'all' | 'store' | 'driver';
type StatusFilter = 'all' | Payout['status'];

const RESULT_LABEL: Record<string, string> = {
  payees: 'payees',
  payouts: 'payouts created',
  carriedOver: 'carried over (net ≤ $0)',
  skippedNoAccount: 'skipped: no payout account',
  resumed: 'resumed',
  errors: 'errors',
};

/**
 * Daily payout runs for stores and drivers (MARKETPLACE §3.9, §9 /payouts): every payout with a
 * drill-down to its ledger entries, the last `runDailyPayouts` run and who it skipped for a missing
 * payout account, and "Run payouts now" for admins where test jobs are allowed.
 */
export default function PayoutsPage() {
  const now = useNow();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const config = useConfig();
  const [payee, setPayee] = useState<PayeeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const filters = useMemo(
    () => ({
      ...(payee === 'all' ? {} : { payeeType: payee }),
      ...(status === 'all' ? {} : { status }),
    }),
    [payee, status],
  );
  const payouts = usePagedQuery(queries.opsPayouts(filters));
  const jobs = useLiveQuery(queries.opsJobs());
  const drivers = useDrivers();

  const run = jobs.data.find((job) => job.job === 'runDailyPayouts') ?? null;
  const result = run?.lastResult ?? null;
  const skipped = typeof result?.skippedNoAccount === 'number' ? result.skippedNoAccount : 0;
  const withoutAccount = drivers.data.filter((driver) => driver.status === 'active' && !driver.payoutAccount);
  const canRun = isAdmin && !!config?.allowTestJobs;

  return (
    <>
      <PageHeader
        title="Payouts"
        description="What stores and drivers were paid in each daily run, and the ledger entries behind it."
        actions={
          canRun ? (
            <Button icon={PlayIcon} onClick={() => setConfirming(true)}>
              Run payouts now
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row">
            <Select
              aria-label="Payee type"
              className="sm:w-44"
              value={payee}
              onChange={(event) => setPayee(event.target.value as PayeeFilter)}
            >
              <option value="all">Stores and drivers</option>
              <option value="store">Stores</option>
              <option value="driver">Drivers</option>
            </Select>
            <Select
              aria-label="Payout status"
              className="sm:w-40"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="all">Any status</option>
              <option value="paid">Paid</option>
              <option value="pending">Sending</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          {payouts.error && payouts.items.length === 0 ? (
            <ErrorState error={payouts.error} onRetry={payouts.retry} className="m-5" />
          ) : payouts.loading && payouts.items.length === 0 ? (
            <PageSpinner label="Loading payouts" />
          ) : payouts.items.length === 0 ? (
            <SceneEmpty
              artKey="scene-order-confirmed"
              title="No payouts yet"
              description="The daily run at 9 pm Toronto time pays every store and driver with a positive balance."
            />
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {payouts.items.map((payout) => (
                  <PayoutRow
                    key={payout.id}
                    payout={payout}
                    now={now}
                    open={expanded === payout.id}
                    onToggle={() => setExpanded(expanded === payout.id ? null : payout.id)}
                  />
                ))}
              </ul>
              <LoadMore
                hasMore={payouts.hasMore}
                loadingMore={payouts.loadingMore}
                onLoadMore={payouts.loadMore}
              />
            </>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Last daily run" description="Every day at 9 pm, Toronto time." />
            <CardBody className="space-y-3 text-sm">
              {jobs.loading && jobs.data.length === 0 ? (
                <Skeleton className="h-20 w-full" />
              ) : jobs.error && jobs.data.length === 0 ? (
                <ErrorState error={jobs.error} onRetry={jobs.retry} title="Couldn't load the scheduler" />
              ) : !run ? (
                <p className="text-slate-500">The payout job has not been scheduled yet.</p>
              ) : (
                <>
                  <p className="text-slate-700">
                    {run.lastFinishedAt
                      ? `Finished ${formatDateTimeET(run.lastFinishedAt, now)}`
                      : run.lastStartedAt
                        ? `Started ${formatRelativeTime(run.lastStartedAt, now)}`
                        : 'Never ran'}
                    {run.lastStatus ? (
                      <Badge tone={run.lastStatus === 'ok' ? 'success' : 'danger'} className="ml-2">
                        {run.lastStatus === 'ok' ? 'OK' : 'Error'}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">Next run {formatDateTimeET(run.nextRunAt, now)}</p>
                  {run.lastError ? (
                    <Callout tone="danger" icon={WarningIcon}>
                      {run.lastError}
                    </Callout>
                  ) : null}
                  {result ? (
                    <ul className="space-y-0.5 text-xs text-slate-600">
                      {Object.entries(result).map(([key, value]) => (
                        <li key={key}>
                          <span className="font-semibold text-slate-800 tabular-nums">{String(value)}</span>{' '}
                          {RESULT_LABEL[key] ?? key}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Drivers without a payout account"
              description={
                skipped
                  ? `The last run skipped ${skipped} payee${skipped === 1 ? '' : 's'} for a missing account.`
                  : 'They are skipped by the run in Stripe mode until an admin adds one.'
              }
            />
            {withoutAccount.length === 0 ? (
              <CardBody>
                <p className="text-sm text-slate-500">Every approved driver has a payout account.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-slate-100">
                {withoutAccount.map((driver) => (
                  <li key={driver.id}>
                    <Link
                      to={`/drivers/${driver.id}`}
                      className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50"
                    >
                      <span className="truncate text-slate-800">{driver.displayName}</span>
                      <ChevronRightIcon size={16} className="text-slate-300" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              Store payout accounts are set on each store’s Settings tab.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Run payouts now?"
        description="Pays every store and driver their unpaid, not held entries up to now, exactly like the 9 pm run. Test environments only."
        confirmLabel="Run payouts"
        onConfirm={async () => {
          const response = await call('runJobNow', { job: 'runDailyPayouts' });
          const created = response.result.payouts ?? 0;
          toast.success('Payout run finished', `${created} payout${created === 1 ? '' : 's'} created.`);
        }}
      />
    </>
  );
}

function PayoutRow({
  payout,
  now,
  open,
  onToggle,
}: {
  payout: WithId<Payout>;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = PAYOUT_STATUS_META[payout.status];
  const payeeLink =
    payout.payeeType === 'driver' ? `/drivers/${payout.payeeId}` : `/stores/${payout.payeeId}`;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} the entries of ${payout.payeeName}'s payout on ${payout.periodDate}`}
          className="grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          {open ? <ChevronDownIcon size={16} aria-hidden /> : <ChevronRightIcon size={16} aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <Link
            to={payeeLink}
            className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700"
          >
            {payout.payeeName}
          </Link>
          <p className="text-xs text-slate-500">
            {payout.payeeType === 'driver' ? 'Driver' : 'Store'} · {payout.periodDate} · {payout.entryCount}{' '}
            entries · {PAYOUT_PROVIDER_LABEL[payout.provider]}
            {payout.reference ? ` · ref ${payout.reference}` : ''}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>
            <Money cents={payout.creditsCents} /> − <Money cents={Math.abs(payout.debitsCents)} />
          </p>
          <p className="text-sm font-semibold text-slate-900">
            <Money cents={payout.netCents} />
          </p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      {open ? <PayoutEntries payout={payout} now={now} /> : null}
    </li>
  );
}

function PayoutEntries({ payout, now }: { payout: WithId<Payout>; now: number }) {
  const entries = usePagedQuery(queries.ledger(payout.payeeType, payout.payeeId, { payoutId: payout.id }));
  return (
    <div className="mx-5 mb-3 rounded-xl bg-slate-50 p-3">
      {entries.error && entries.items.length === 0 ? (
        <ErrorState error={entries.error} onRetry={entries.retry} />
      ) : entries.loading && entries.items.length === 0 ? (
        <Skeleton className="h-16 w-full" />
      ) : entries.items.length === 0 ? (
        <p className="text-sm text-slate-500">No entries.</p>
      ) : (
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">Ledger entries in this payout</caption>
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                Entry
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Kind
              </th>
              <th scope="col" className="hidden py-1 pr-3 font-medium sm:table-cell">
                Date
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {entries.items.map((entry) => (
              <tr key={entry.id}>
                <td className="py-1.5 pr-3 text-slate-800">
                  {entry.deliveryId ? (
                    <Link to={`/deliveries/${entry.deliveryId}`} className="hover:text-brand-700">
                      {entry.description}
                    </Link>
                  ) : entry.orderId ? (
                    <Link to={`/orders/${entry.orderId}`} className="hover:text-brand-700">
                      {entry.description}
                    </Link>
                  ) : (
                    entry.description
                  )}
                </td>
                <td className="py-1.5 pr-3 text-slate-500">{LEDGER_KIND_LABEL[entry.kind]}</td>
                <td className="hidden py-1.5 pr-3 text-slate-500 sm:table-cell">
                  {formatDateTimeET(entry.createdAt, now)}
                </td>
                <td
                  className={
                    entry.amountCents < 0
                      ? 'py-1.5 text-right text-rose-600'
                      : 'py-1.5 text-right text-slate-800'
                  }
                >
                  <Money cents={entry.amountCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore hasMore={entries.hasMore} loadingMore={entries.loadingMore} onLoadMore={entries.loadMore} />
    </div>
  );
}
