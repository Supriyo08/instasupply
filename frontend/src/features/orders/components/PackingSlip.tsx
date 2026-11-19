import { formatAddress, formatCurrency, formatDateTime, pluralize } from '@instasupply/shared';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import type { OrderRecord } from '@/lib/data';

import { cashToCollect, paymentMethodLabel, paymentStatusMeta } from '../order-format';

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-[10px] font-semibold tracking-wider text-slate-600 uppercase">{children}</h2>;
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn('flex justify-between gap-4', strong && 'border-t border-black pt-1 text-sm font-bold')}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Print-only packing slip. It renders beside the app (outside #root) and, while it is mounted, the
 * app itself is hidden from print, so the printout is just the slip, whether staff use the
 * "Print packing slip" button or the browser's own print command.
 */
export function PackingSlip({ order, driverName }: { order: OrderRecord; driverName: string | null }) {
  useEffect(() => {
    const root = document.getElementById('root');
    root?.classList.add('print:hidden');
    return () => root?.classList.remove('print:hidden');
  }, []);

  const cash = cashToCollect(order);

  return createPortal(
    <article className="hidden text-[12px] leading-snug text-black print:block">
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider uppercase">InstaSupply</p>
          <h1 className="text-xl font-bold">Packing slip</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold">{order.number}</p>
          <p>Placed {formatDateTime(order.createdAt)}</p>
          {order.status === 'cancelled' ? <p className="mt-1 font-bold uppercase">Order cancelled</p> : null}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-slate-300 py-3">
        <div>
          <Heading>Deliver to</Heading>
          <p className="mt-1 text-sm font-semibold">{order.address.name}</p>
          <p>{order.address.phone}</p>
          <p>{formatAddress(order.address)}</p>
          {order.address.landmark ? <p>Landmark: {order.address.landmark}</p> : null}
        </div>
        <div>
          <Heading>Payment</Heading>
          <p className="mt-1 text-sm font-semibold">
            {cash != null
              ? `Collect ${formatCurrency(cash)} in cash`
              : `${paymentMethodLabel(order)} · ${paymentStatusMeta(order).label}`}
          </p>
          {driverName ? <p className="mt-2">Driver: {driverName}</p> : null}
        </div>
      </section>

      {order.notes ? (
        <p className="border-b border-slate-300 py-2">
          <span className="font-semibold">Delivery notes:</span> {order.notes}
        </p>
      ) : null}

      <table className="mt-3 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black text-[10px] tracking-wider uppercase">
            <th scope="col" className="w-7 py-1.5">
              <span className="sr-only">Packed</span>
            </th>
            <th scope="col" className="w-12 py-1.5">
              Qty
            </th>
            <th scope="col" className="py-1.5">
              Item
            </th>
            <th scope="col" className="py-1.5">
              Pack
            </th>
            <th scope="col" className="py-1.5 text-right">
              Price
            </th>
            <th scope="col" className="py-1.5 text-right">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={`${item.productId}-${index}`} className="break-inside-avoid border-b border-slate-300">
              <td className="py-2 align-top">
                <span className="inline-block size-3.5 border border-black" />
              </td>
              <td className="py-2 align-top text-sm font-bold tabular-nums">{item.quantity}</td>
              <td className="py-2 align-top font-medium">{item.name}</td>
              <td className="py-2 align-top">{item.unit}</td>
              <td className="py-2 text-right align-top tabular-nums">{formatCurrency(item.price)}</td>
              <td className="py-2 text-right align-top tabular-nums">{formatCurrency(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex break-inside-avoid items-start justify-between gap-6">
        <p>
          {pluralize(order.itemCount, 'item')} · {pluralize(order.items.length, 'product')}
        </p>
        <dl className="w-60 space-y-1">
          <TotalRow label="Subtotal" value={formatCurrency(order.subtotal)} />
          <TotalRow
            label="Delivery fee"
            value={order.deliveryFee > 0 ? formatCurrency(order.deliveryFee) : 'Free'}
          />
          {order.discount > 0 ? (
            <TotalRow
              label={order.promoCode ? `Discount (${order.promoCode})` : 'Discount'}
              value={`−${formatCurrency(order.discount)}`}
            />
          ) : null}
          <TotalRow label="Total" value={formatCurrency(order.total)} strong />
        </dl>
      </div>

      <footer className="mt-12 grid break-inside-avoid grid-cols-2 gap-12">
        <p className="border-t border-black pt-1">Packed by</p>
        <p className="border-t border-black pt-1">Checked by</p>
      </footer>
    </article>,
    document.body,
  );
}
