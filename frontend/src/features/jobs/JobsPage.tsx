import { useLiveQuery } from '@instasupply/api-client/react';
import {
  formatClockET,
  formatDateTimeET,
  formatDayET,
  formatPhone,
  formatRelativeTime,
  type JobOffer,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { Callout, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { ClockIcon, InfoIcon, StoreIcon, UsersIcon, WarningIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { Money } from '@/components/ui/Money';
import { AssignDialog } from '@/features/deliveries/components/AssignDialog';
import { LabourerForm } from '@/features/deliveries/components/LabourerForm';
import { SceneEmpty } from '@/features/deliveries/components/SceneArt';
import { vehicleClassLabel } from '@/features/deliveries/delivery-format';
import { queries, type WithId } from '@/lib/api';
import { cn } from '@/lib/cn';
import { indexById, useOpenDeliveries, type DeliveryRecord } from '@/lib/data';

type Tab = 'open' | 'scheduled' | 'labourers';

/** An open offer nobody has claimed after this long is highlighted (MARKETPLACE §9, dashboard KPI). */
const UNCLAIMED_MS = 15 * 60_000;

const UNLOAD_LABEL: Record<JobOffer['unload'], string> = {
  driver: 'Driver unloads',
  site_crew: 'Site crew unloads',
  labourer: 'Labourer booked',
};

/**
 * The job board as ops see it (MARKETPLACE §9 /jobs): scheduled and open offers with age, class, payout,
 * ready time and store → area; Assign to any driver whose vehicle can carry it (`force` after a
 * warning); and the labourer queue for deliveries that need help unloading.
 */
export default function JobsPage() {
  const now = useServerNow(30_000);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'scheduled' || tabParam === 'labourers' ? tabParam : 'open';
  const offers = useLiveQuery(queries.opsJobOffers());
  const labourers = useLiveQuery(queries.labourerQueue());
  const open = useOpenDeliveries();
  const [assigning, setAssigning] = useState<DeliveryRecord | null>(null);

  const deliveryById = useMemo(() => indexById(open.data), [open.data]);
  const openOffers = useMemo(
    () =>
      offers.data
        .filter((offer) => offer.status === 'open')
        .sort((a, b) => (a.openedAt ?? a.opensAt) - (b.openedAt ?? b.opensAt)),
    [offers.data],
  );
  const scheduled = useMemo(
    () => offers.data.filter((offer) => offer.status === 'scheduled').sort((a, b) => a.opensAt - b.opensAt),
    [offers.data],
  );
  const unclaimed = openOffers.filter(
    (offer) => now - (offer.openedAt ?? offer.opensAt) > UNCLAIMED_MS,
  ).length;
  const queue = labourers.data.filter((delivery) => delivery.unload?.status === 'needed');

  const list = tab === 'open' ? openOffers : scheduled;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Store orders waiting for a driver on the job board, and sites that need a labourer."
      />

      {unclaimed > 0 ? (
        <div className="mb-4">
          <Callout
            tone="warning"
            icon={WarningIcon}
            title={`${unclaimed} open job${unclaimed === 1 ? '' : 's'} unclaimed for more than 15 minutes`}
          >
            Assign a driver yourself, or call drivers near the store.
          </Callout>
        </div>
      ) : null}

      <Card>
        <div className="px-5 pt-2">
          <Tabs
            ariaLabel="Job board"
            value={tab}
            onChange={(value) => setParams(value === 'open' ? {} : { tab: value }, { replace: true })}
            items={[
              { value: 'open', label: 'Open', count: openOffers.length },
              { value: 'scheduled', label: 'Scheduled', count: scheduled.length },
              { value: 'labourers', label: 'Labourer queue', count: queue.length },
            ]}
          />
        </div>

        {tab === 'labourers' ? (
          <LabourerQueue deliveries={queue} query={labourers} now={now} />
        ) : offers.error && offers.data.length === 0 ? (
          <ErrorState error={offers.error} onRetry={offers.retry} className="m-5" />
        ) : offers.loading && offers.data.length === 0 ? (
          <PageSpinner label="Loading the job board" />
        ) : list.length === 0 ? (
          <SceneEmpty
            artKey="scene-local-suppliers"
            title={tab === 'open' ? 'No open jobs' : 'Nothing scheduled'}
            description={
              tab === 'open'
                ? 'Every accepted store order has a driver. New jobs appear here as soon as a store accepts an order.'
                : 'Jobs for later deliveries open on the board 12 hours before pickup.'
            }
          />
        ) : (
          <OfferTable
            offers={list}
            now={now}
            deliveryById={deliveryById}
            onAssign={setAssigning}
            scheduled={tab === 'scheduled'}
          />
        )}
      </Card>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <InfoIcon size={14} aria-hidden /> Boosting a job’s payout comes later; assign a driver directly when
        a job is stuck.
      </p>

      <AssignDialog delivery={assigning} open={!!assigning} onClose={() => setAssigning(null)} />
    </>
  );
}

function OfferTable({
  offers,
  now,
  deliveryById,
  onAssign,
  scheduled,
}: {
  offers: WithId<JobOffer>[];
  now: number;
  deliveryById: Map<string, DeliveryRecord>;
  onAssign: (delivery: DeliveryRecord) => void;
  scheduled: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{scheduled ? 'Scheduled jobs' : 'Open jobs, oldest first'}</caption>
        <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Job
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Store → area
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              {scheduled ? 'Opens' : 'Age'}
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">
              Ready
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
              Class · load
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Payout
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {offers.map((offer) => {
            const openedAt = offer.openedAt ?? offer.opensAt;
            const stale = !scheduled && now - openedAt > UNCLAIMED_MS;
            const delivery = deliveryById.get(offer.deliveryId) ?? null;
            return (
              <tr key={offer.id} className={cn(stale ? 'bg-amber-50/60' : 'hover:bg-slate-50')}>
                <td className="px-5 py-3 align-top">
                  <Link
                    to={`/deliveries/${offer.deliveryId}`}
                    className="font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
                  >
                    {offer.storeOrderNumber}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {offer.window.kind === 'asap' ? 'ASAP · ' : ''}
                    {offer.window.label}
                  </p>
                </td>
                <td className="max-w-64 px-3 py-3 align-top">
                  <p className="flex items-center gap-1 truncate font-medium text-slate-900">
                    <StoreIcon size={13} className="shrink-0 text-amber-600" aria-hidden />
                    {offer.pickup.storeName}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {offer.pickup.areaLabel} → {offer.dropoff.areaLabel} · {offer.tripKm.toFixed(1)} km
                  </p>
                </td>
                <td className="px-3 py-3 align-top whitespace-nowrap">
                  {scheduled ? (
                    <span className="text-slate-700">
                      {formatDayET(offer.opensAt, now)}, {formatClockET(offer.opensAt)}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        stale ? 'font-semibold text-amber-800' : 'text-slate-700',
                      )}
                    >
                      <ClockIcon size={13} aria-hidden />
                      {formatRelativeTime(openedAt, now).replace(' ago', '')}
                      {stale ? <span className="sr-only"> (unclaimed for more than 15 minutes)</span> : null}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-3 align-top whitespace-nowrap md:table-cell">
                  {offer.pickup.ready ? (
                    <Badge tone="success">Ready now</Badge>
                  ) : (
                    <span className="text-slate-700" title={formatDateTimeET(offer.pickup.readyBy, now)}>
                      by {formatClockET(offer.pickup.readyBy)}
                    </span>
                  )}
                </td>
                <td className="hidden max-w-72 px-3 py-3 align-top lg:table-cell">
                  <p className="font-medium text-slate-800">{vehicleClassLabel(offer.vehicleClass)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {offer.load.summary} · {offer.load.weightKg} kg
                    {offer.load.hasSheets ? ' · 4×8 sheets' : ''}
                  </p>
                  <p className="text-xs text-slate-400">{UNLOAD_LABEL[offer.unload]}</p>
                </td>
                <td className="px-3 py-3 text-right align-top font-medium text-slate-900">
                  <Money cents={offer.payoutCents} />
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <Button
                    size="sm"
                    variant={stale ? 'primary' : 'secondary'}
                    disabled={!delivery}
                    title={delivery ? undefined : 'Loading the delivery…'}
                    onClick={() => delivery && onAssign(delivery)}
                    aria-label={`Assign ${offer.storeOrderNumber}`}
                  >
                    Assign
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LabourerQueue({
  deliveries,
  query,
  now,
}: {
  deliveries: DeliveryRecord[];
  query: { loading: boolean; error: unknown; retry: () => void; data: unknown[] };
  now: number;
}) {
  if (query.error && query.data.length === 0) {
    return <ErrorState error={query.error} onRetry={query.retry} className="m-5" />;
  }
  if (query.loading && query.data.length === 0) return <PageSpinner label="Loading the labourer queue" />;
  if (deliveries.length === 0) {
    return (
      <SceneEmpty
        artKey="scene-jobsite-delivery"
        title="No site waiting for a labourer"
        description="Deliveries where the customer asked for unloading help, or where a heavy load goes to an unattended site, appear here."
      />
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {deliveries.map((delivery) => (
        <li key={delivery.id} className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                to={`/deliveries/${delivery.id}`}
                className="font-mono text-sm font-semibold text-slate-900 hover:text-brand-700"
              >
                {delivery.orderId}
              </Link>
              <p className="text-sm text-slate-700">
                {delivery.customer.name}
                {delivery.customer.phone ? ` · ${formatPhone(delivery.customer.phone)}` : ''}
              </p>
              <p className="text-xs text-slate-500">
                {delivery.address}
                {delivery.windowEnd != null ? ` · by ${formatDateTimeET(delivery.windowEnd, now)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {delivery.unload?.required ? (
                <Badge tone="danger">Required</Badge>
              ) : (
                <Badge tone="info">Requested</Badge>
              )}
              {delivery.load?.heavy ? <Badge tone="warning">Heavy load</Badge> : null}
              <Badge tone="neutral">
                <UsersIcon size={12} aria-hidden />{' '}
                {delivery.load
                  ? `${delivery.load.pieces} pcs · ${delivery.load.weightKg} kg`
                  : `${delivery.packageCount} pcs`}
              </Badge>
            </div>
          </div>
          <LabourerForm delivery={delivery} compact />
        </li>
      ))}
    </ul>
  );
}
