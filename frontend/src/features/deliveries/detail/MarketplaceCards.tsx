import { useLiveQuery } from '@instasupply/api-client/react';
import {
  formatDateTimeET,
  formatPhone,
  formatRelativeTime,
  STORE_ORDER_META,
  VEHICLE_CLASSES,
} from '@instasupply/shared';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { ExternalLinkIcon, PhoneIcon, StoreIcon, SuccessIcon, UsersIcon } from '@/components/ui/icons';
import { Money } from '@/components/ui/Money';
import { queries } from '@/lib/api';
import type { DeliveryRecord } from '@/lib/data';

import { LabourerForm } from '../components/LabourerForm';
import { OFFER_STATUS_META, vehicleClassLabel } from '../delivery-format';

/** The pickup at the store (MARKETPLACE §9 delivery detail): ready, driver arrived, collected. */
export function PickupCard({ delivery, now }: { delivery: DeliveryRecord; now: number }) {
  const pickup = delivery.pickup;
  if (!pickup) return null;
  const offer = delivery.offerStatus ? OFFER_STATUS_META[delivery.offerStatus] : null;
  const steps = [
    { label: 'Ready at the store', at: pickup.readyAt, done: pickup.ready },
    { label: 'Driver at the counter', at: pickup.arrivedAt, done: pickup.arrivedAt != null },
    { label: 'Collected', at: pickup.collectedAt, done: pickup.collectedAt != null },
  ];
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <StoreIcon size={16} className="text-amber-600" aria-hidden /> Pickup at {pickup.storeName}
          </span>
        }
        description={pickup.address}
        action={offer ? <Badge tone={offer.tone}>{offer.label}</Badge> : null}
      />
      <CardBody className="space-y-3 text-sm">
        <ol className="grid gap-2 sm:grid-cols-3" aria-label="Pickup progress">
          {steps.map((step) => (
            <li
              key={step.label}
              className={
                step.done
                  ? 'rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200'
                  : 'rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200'
              }
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                {step.done ? <SuccessIcon size={14} className="text-emerald-600" aria-hidden /> : null}
                {step.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {step.at ? formatDateTimeET(step.at, now) : step.done ? 'Yes' : 'Not yet'}
              </p>
            </li>
          ))}
        </ol>
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Ready by">{formatDateTimeET(pickup.readyBy, now)}</DetailRow>
          <DetailRow label="Store phone">
            <a href={`tel:${pickup.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-700">
              <PhoneIcon size={14} aria-hidden /> {formatPhone(pickup.phone)}
            </a>
          </DetailRow>
          {pickup.loadingNotes ? <DetailRow label="Loading notes">{pickup.loadingNotes}</DetailRow> : null}
          {offer && delivery.status === 'unassigned' ? (
            <DetailRow label="Job board">
              {offer.hint}
              {delivery.offerOpensAt && delivery.offerStatus === 'scheduled'
                ? ` Opens ${formatDateTimeET(delivery.offerOpensAt, now)}.`
                : ''}
            </DetailRow>
          ) : null}
        </dl>
      </CardBody>
    </Card>
  );
}

/** What is on the truck: the load summary and its lines. */
export function LoadCard({ delivery }: { delivery: DeliveryRecord }) {
  const load = delivery.load;
  if (!load) return null;
  const spec = delivery.vehicleClass ? VEHICLE_CLASSES[delivery.vehicleClass] : null;
  return (
    <Card>
      <CardHeader
        title="Load manifest"
        description={load.summary}
        action={
          <Badge tone="brand">
            {vehicleClassLabel(delivery.vehicleClass)}
            {spec ? ` · up to ${spec.maxKg} kg` : ''}
          </Badge>
        }
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          {[
            { label: 'Pieces', value: String(load.pieces) },
            { label: 'Weight', value: `${load.weightKg} kg` },
            { label: 'Longest', value: `${Math.round(load.longestCm)} cm` },
            { label: 'Volume', value: `${Math.round(load.volumeL)} L` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl bg-slate-50 p-2.5">
              <p className="text-[11px] text-slate-500 uppercase">{item.label}</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {load.hasSheets ? <Badge tone="warning">4×8 sheets</Badge> : null}
          {load.heavy ? <Badge tone="danger">Heavy load</Badge> : null}
          {load.handlingPieces ? <Badge tone="neutral">{load.handlingPieces} handling pieces</Badge> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <caption className="sr-only">Lines in the load</caption>
            <thead className="text-slate-500">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Item
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Size
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  kg each
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {load.lines.map((line, index) => (
                <tr key={`${line.name}-${index}`}>
                  <td className="py-1.5 pr-3 text-slate-800">{line.name}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{line.size ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-800 tabular-nums">
                    {line.quantity} {line.unit}
                  </td>
                  <td className="py-1.5 text-right text-slate-500 tabular-nums">{line.weightKg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/** Help with unloading at the site, and the labourer staff booked. */
export function UnloadCard({ delivery }: { delivery: DeliveryRecord }) {
  const unload = delivery.unload;
  if (!unload || (!unload.labourer && unload.status === 'not_needed')) return null;
  const closed = ['delivered', 'cancelled'].includes(delivery.status);
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <UsersIcon size={16} className="text-slate-500" aria-hidden /> Unloading help
          </span>
        }
        description={
          unload.required
            ? 'Required: heavy load at an unattended site.'
            : 'The customer asked for a labourer.'
        }
        action={
          <Badge
            tone={unload.status === 'booked' ? 'success' : unload.status === 'needed' ? 'warning' : 'neutral'}
          >
            {unload.status === 'booked'
              ? 'Booked'
              : unload.status === 'needed'
                ? 'Needs a labourer'
                : 'Not needed'}
          </Badge>
        }
      />
      <CardBody>
        {closed ? (
          <p className="text-sm text-slate-600">
            {unload.labourerName
              ? `${unload.labourerName}${unload.labourerPhone ? ` · ${formatPhone(unload.labourerPhone)}` : ''}`
              : 'No labourer was booked.'}
          </p>
        ) : (
          <LabourerForm key={`${unload.status}-${unload.labourerName ?? ''}`} delivery={delivery} />
        )}
      </CardBody>
    </Card>
  );
}

/** What the driver earns for this trip (MARKETPLACE §3.10). */
export function PayoutCard({ delivery }: { delivery: DeliveryRecord }) {
  const payout = delivery.payout;
  if (!payout) return null;
  return (
    <Card>
      <CardHeader title="Driver payout" description="Fixed at checkout; it never drifts." />
      <CardBody>
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Base">
            <Money cents={payout.baseCents} />
          </DetailRow>
          <DetailRow
            label={`Distance${delivery.tripKm != null ? ` (${delivery.tripKm.toFixed(1)} km)` : ''}`}
          >
            <Money cents={payout.distanceCents} />
          </DetailRow>
          <DetailRow label="Load">
            <Money cents={payout.loadCents} />
          </DetailRow>
          <DetailRow label="Handling">
            <Money cents={payout.handlingCents} />
          </DetailRow>
          {payout.boostCents ? (
            <DetailRow label="Boost">
              <Money cents={payout.boostCents} />
            </DetailRow>
          ) : null}
          {payout.waitCents ? (
            <DetailRow label="Wait at the store">
              <Money cents={payout.waitCents} />
            </DetailRow>
          ) : null}
          <DetailRow label="Total">
            <span className="font-semibold text-slate-900">
              <Money cents={payout.totalCents} />
            </span>
          </DetailRow>
        </dl>
      </CardBody>
    </Card>
  );
}

/** The store order this delivery carries, with a link to the order page. */
export function LinkedStoreOrderCard({ delivery, now }: { delivery: DeliveryRecord; now: number }) {
  const storeOrder = useLiveQuery(queries.storeOrder(delivery.storeOrderId));
  if (!delivery.storeOrderId) return null;
  const order = storeOrder.data;
  return (
    <Card>
      <CardHeader
        title="Store order"
        action={
          delivery.sourceOrderId ? (
            <Link
              to={`/orders/${delivery.sourceOrderId}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
            >
              Open order <ExternalLinkIcon size={12} aria-hidden />
            </Link>
          ) : null
        }
      />
      <CardBody>
        {storeOrder.loading && !order ? (
          <Skeleton className="h-16 w-full" />
        ) : storeOrder.error && !order ? (
          <ErrorState error={storeOrder.error} onRetry={storeOrder.retry} />
        ) : !order ? (
          <p className="text-sm text-slate-500">The store order could not be found.</p>
        ) : (
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Number">
              <span className="font-mono">{order.number}</span>
            </DetailRow>
            <DetailRow label="Status">
              <Badge tone={STORE_ORDER_META[order.status].tone}>{STORE_ORDER_META[order.status].label}</Badge>
            </DetailRow>
            <DetailRow label="Customer">{order.companyName ?? order.customerName}</DetailRow>
            <DetailRow label="Items">{order.itemsSummary}</DetailRow>
            {order.window ? <DetailRow label="Window">{order.window.label}</DetailRow> : null}
            <DetailRow label="Updated">{formatRelativeTime(order.updatedAt, now)}</DetailRow>
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
