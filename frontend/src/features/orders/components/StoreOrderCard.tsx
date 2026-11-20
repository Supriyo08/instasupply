/**
 * One store order on the ops order page (MARKETPLACE §9): status, store, SLA timers, driver, delivery
 * link, pick list with shortages, amounts, history and the staff actions.
 */
import { useLiveQuery } from '@instasupply/api-client/react';
import {
  STORE_ORDER_META,
  VEHICLE_CLASSES,
  formatDateTimeET,
  formatMoney,
  pluralize,
  type Amounts,
  type DriverPhase,
  type StoreOrder,
  type StoreOrderPrivateMeta,
} from '@instasupply/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { Countdown } from '@/components/ui/Countdown';
import { ChevronRightIcon, KeyIcon, TruckIcon } from '@/components/ui/icons';
import { queries } from '@/lib/api';

import { SHORT_REASONS, rejectReasonLabel } from '../order-format';
import { ItemThumb } from './ItemThumb';
import { AttentionBadge, FulfilmentBadge, StoreOrderStatusBadge } from './OrderBadges';
import { StoreOrderActions } from './StoreOrderActions';

export const DRIVER_PHASE_LABELS: Record<DriverPhase, string> = {
  assigned: 'assigned',
  to_store: 'heading to the store',
  at_store: 'at the counter',
  loaded: 'loaded',
  to_site: 'on the way to the site',
  at_site: 'at the site',
  delivered: 'delivered',
  problem: 'has a problem',
};

const SHORT_LABELS = Object.fromEntries(SHORT_REASONS.map((reason) => [reason.id, reason.label]));

/** "Marco · F-150 · CBKX 214 · at the counter". */
export function driverChip(driver: NonNullable<StoreOrder['driver']>): string {
  return [driver.firstName, driver.vehicleLabel, driver.plate, DRIVER_PHASE_LABELS[driver.phase]]
    .filter(Boolean)
    .join(' · ');
}

/** The SLA line of a store order: what the store owes next and by when. */
export function StoreOrderTimer({ storeOrder }: { storeOrder: StoreOrder }) {
  const { status, timing, pickup } = storeOrder;
  if (status === 'new')
    return <Countdown deadline={timing.respondBy} prefix="Accept within" overdueLabel="Overdue" />;
  if (status === 'accepted' || status === 'preparing') {
    return (
      <Countdown deadline={timing.readyBy} prefix="Ready within" overdueLabel="Late" warnMs={15 * 60_000} />
    );
  }
  if (status === 'ready' && storeOrder.fulfilment === 'pickup' && pickup.holdUntil) {
    return <span className="text-slate-600">Held until {formatDateTimeET(pickup.holdUntil)}</span>;
  }
  if ((status === 'ready' || status === 'out_for_delivery') && timing.deliverBy) {
    return <span className="text-slate-600">Deliver by {formatDateTimeET(timing.deliverBy)}</span>;
  }
  return null;
}

function AmountRows({ amounts, placed }: { amounts: Amounts; placed: Amounts }) {
  const changed = amounts.totalCents !== placed.totalCents;
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      <DetailRow label="Items">{formatMoney(amounts.itemsCents)}</DetailRow>
      {amounts.discountCents > 0 ? (
        <DetailRow label="Discount">−{formatMoney(amounts.discountCents)}</DetailRow>
      ) : null}
      <DetailRow label="Delivery fee">{formatMoney(amounts.deliveryFeeCents)}</DetailRow>
      {amounts.unloadFeeCents > 0 ? (
        <DetailRow label="Labourer">{formatMoney(amounts.unloadFeeCents)}</DetailRow>
      ) : null}
      <DetailRow label="HST">{formatMoney(amounts.taxCents)}</DetailRow>
      <DetailRow label="Total">
        <span className="font-semibold">{formatMoney(amounts.totalCents)}</span>
        {changed ? (
          <span className="block text-xs font-normal text-slate-500">
            placed at <s>{formatMoney(placed.totalCents)}</s>
          </span>
        ) : null}
      </DetailRow>
    </dl>
  );
}

function PrivateMetaRow({ meta }: { meta: StoreOrderPrivateMeta | null }) {
  const [shown, setShown] = useState(false);
  if (!meta) return null;
  const { pickupCode, pickupCodeIssuedTo, codeAttempts, commissionBps } = meta;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <KeyIcon size={14} aria-hidden />
        {pickupCode ? (
          <>
            PIN issued to {pickupCodeIssuedTo === 'customer' ? 'the customer' : 'the driver'}
            {codeAttempts > 0 ? ` · ${pluralize(codeAttempts, 'wrong attempt')}` : ''}
            <button
              type="button"
              className="font-semibold text-brand-600 hover:text-brand-700"
              onClick={() => setShown((value) => !value)}
              aria-pressed={shown}
            >
              {shown ? <span className="font-mono">{pickupCode}</span> : 'Show PIN'}
            </button>
          </>
        ) : (
          'No pickup PIN yet'
        )}
      </span>
      <span>Commission {(commissionBps / 100).toFixed(1)} %</span>
    </div>
  );
}

function DeliveryLink({ deliveryId }: { deliveryId: string }) {
  const delivery = useLiveQuery(queries.delivery(deliveryId));
  return (
    <Link
      to={`/deliveries/${encodeURIComponent(deliveryId)}`}
      className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 ring-1 ring-brand-200 hover:bg-brand-50"
    >
      <TruckIcon size={14} aria-hidden />
      Delivery
      {delivery.data ? <StatusBadge status={delivery.data.status} /> : null}
      <ChevronRightIcon size={14} aria-hidden />
    </Link>
  );
}

export function StoreOrderCard({ storeOrder }: { storeOrder: StoreOrder }) {
  const privateMeta = useLiveQuery(queries.storeOrderPrivate(storeOrder.id));
  const history = [...storeOrder.history].reverse();
  const reason = rejectReasonLabel(storeOrder.rejectReason);

  return (
    <Card aria-labelledby={`so-${storeOrder.id}`}>
      <CardHeader
        title={
          <span id={`so-${storeOrder.id}`} className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{storeOrder.number}</span>
            <Link to={`/stores/${encodeURIComponent(storeOrder.storeId)}`} className="hover:text-brand-700">
              {storeOrder.storeName}
            </Link>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StoreOrderStatusBadge status={storeOrder.status} />
            <FulfilmentBadge fulfilment={storeOrder.fulfilment} />
            {storeOrder.acceptOverdue ? <AttentionBadge label="Not accepted in time" /> : null}
            {storeOrder.issueCount > 0 ? (
              <Badge tone="warning">{pluralize(storeOrder.issueCount, 'issue')}</Badge>
            ) : null}
            <StoreOrderTimer storeOrder={storeOrder} />
          </span>
        }
        action={<StoreOrderActions storeOrder={storeOrder} privateMeta={privateMeta.data} />}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {storeOrder.driver ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-slate-200">
              <TruckIcon size={14} aria-hidden /> {driverChip(storeOrder.driver)}
            </span>
          ) : storeOrder.fulfilment === 'delivery' &&
            storeOrder.status !== 'cancelled' &&
            storeOrder.status !== 'rejected' ? (
            <span className="text-xs text-slate-500">No driver yet</span>
          ) : null}
          {storeOrder.deliveryId ? <DeliveryLink deliveryId={storeOrder.deliveryId} /> : null}
          {storeOrder.vehicleClass ? (
            <span className="text-xs text-slate-500">
              {storeOrder.load.weightKg} kg · {VEHICLE_CLASSES[storeOrder.vehicleClass].label}
              {storeOrder.roadKm != null ? ` · ${storeOrder.roadKm.toFixed(1)} km` : ''}
            </span>
          ) : null}
        </div>
        {reason || storeOrder.cancelReason ? (
          <p className="text-sm text-slate-600">
            {storeOrder.status === 'rejected' ? 'Rejected' : 'Cancelled'}
            {storeOrder.cancelledBy ? ` by ${storeOrder.cancelledBy}` : ''}:{' '}
            {reason ?? storeOrder.cancelReason}
          </p>
        ) : null}
        <PrivateMetaRow meta={privateMeta.data} />

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Pick list of {storeOrder.number}</caption>
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                  Unit price
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {storeOrder.lines.map((line) => {
                const short = line.fulfilledQty < line.quantity;
                return (
                  <tr key={line.lineId}>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-3">
                        <ItemThumb item={line} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            {line.name}
                            {line.kind === 'custom' ? (
                              <Badge tone="info" className="ml-2">
                                Special order
                              </Badge>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-500">
                            {[line.sku, line.brand, line.size, line.unit].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {short ? (
                        <>
                          <span className="font-semibold text-amber-700">{line.fulfilledQty}</span>
                          <span className="text-slate-400"> of {line.quantity}</span>
                          <span className="block text-xs text-amber-700">
                            {line.shortReason ? SHORT_LABELS[line.shortReason] : 'Short'}
                          </span>
                        </>
                      ) : (
                        line.quantity
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                      {formatMoney(line.unitPriceCents)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">{formatMoney(line.lineCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <AmountRows amounts={storeOrder.current} placed={storeOrder.placed} />
          <section aria-label={`History of ${storeOrder.number}`}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">History</h3>
            <ol className="space-y-2 text-sm">
              {history.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{STORE_ORDER_META[entry.status].label}</span>
                    <span className="text-slate-500">
                      {' '}
                      · {formatDateTimeET(entry.at)}
                      {entry.actorName
                        ? ` · ${entry.actorName}`
                        : entry.actorRole === 'system'
                          ? ' · automatic'
                          : ''}
                    </span>
                    {entry.note ? <span className="block text-xs text-slate-500">{entry.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </CardBody>
    </Card>
  );
}
