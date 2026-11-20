import { STORE_ORDER_META, type StoreOrder } from '@instasupply/shared';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Countdown } from '@/components/ui/Countdown';
import { CarIcon, PackageIcon, StoreIcon, TruckIcon, WarningIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import { customerLabel, driverChip, jobsiteArea, loadChip, promiseLabel } from './order-format';

/**
 * One store order on the board, in the site's style: "NMD90 14/2 cable, 75 m + 1 item · Whitfield
 * Renovations · Leslieville · Delivery by 1:50 pm", with the fulfilment badge, the countdown that
 * matters for its lane, the load chip and the driver chip (MARKETPLACE §8).
 */
export function StoreOrderCard({ order, now }: { order: StoreOrder; now: number }) {
  const meta = STORE_ORDER_META[order.status];
  const customer = customerLabel(order);
  const area = jobsiteArea(order);
  const promise = promiseLabel(order, now);
  const failed = order.status === 'failed';
  const summary = [order.itemsSummary, customer, area, promise].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/portal/orders/${encodeURIComponent(order.id)}`}
      aria-label={`${order.number}, ${meta.label}: ${summary}`}
      className={cn(
        'block rounded-xl border bg-white p-3 text-left shadow-card transition-shadow hover:shadow-pop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        order.status === 'new' ? 'border-amber-300' : failed ? 'border-rose-300' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-xs font-semibold text-slate-900">{order.number}</p>
        <Badge tone={order.fulfilment === 'pickup' ? 'info' : 'brand'}>
          {order.fulfilment === 'pickup' ? (
            <StoreIcon size={12} aria-hidden />
          ) : (
            <TruckIcon size={12} aria-hidden />
          )}
          {order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}
        </Badge>
      </div>

      <p className="mt-1.5 line-clamp-2 text-sm font-medium text-slate-900">{order.itemsSummary}</p>
      <p className="mt-0.5 truncate text-xs text-slate-600">{[customer, area].filter(Boolean).join(' · ')}</p>
      <p className="mt-0.5 text-xs text-slate-600">{promise}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {order.status === 'new' ? (
          <Countdown deadline={order.timing.respondBy} prefix="Accept within" overdueLabel="Overdue by" />
        ) : order.status === 'accepted' || order.status === 'preparing' ? (
          <Countdown
            deadline={order.timing.readyBy}
            prefix="Ready in"
            overdueLabel="Late by"
            warnMs={15 * 60_000}
            urgentMs={5 * 60_000}
          />
        ) : null}
        {failed ? (
          <Badge tone="danger">
            <WarningIcon size={12} aria-hidden /> {meta.label}: InstaSupply is on it
          </Badge>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
          <PackageIcon size={12} aria-hidden /> {loadChip(order)}
        </span>
        {order.driver ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-800">
            <CarIcon size={12} aria-hidden className="shrink-0" />
            <span className="truncate">{driverChip(order.driver)}</span>
          </span>
        ) : null}
        {order.issueCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700">
            Issue reported
          </span>
        ) : null}
      </div>
    </Link>
  );
}
