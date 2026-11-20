import { formatDateTimeET, formatMoney, pluralize, type StoreOrder } from '@instasupply/shared';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { customerLabel, jobsiteArea, promiseLabel, shortReasonLabel } from './order-format';

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-[10px] font-semibold tracking-wider text-black uppercase">{children}</h2>;
}

/**
 * Print-only pick slip for one store order (MARKETPLACE §8, §12.5: moved here from the ops orders
 * feature). It renders beside the app (outside #root); while it is mounted the app is hidden from
 * print, so the printout is just the slip, from the "Print pick slip" button or the browser's own
 * print command.
 *
 * Review fixes (ux #12): a visible ✓ column header, "Size" instead of "Pack", dark rules that survive
 * thermal and low-toner printers, and a first header row with the order number and customer that the
 * browser repeats on every printed page. Correctness #4: the slip shows only what the store order
 * itself carries (items, customer, area, promise), never a delivery address that dispatch may have
 * corrected since checkout; the driver has the current address.
 */
export function PickSlip({ order, now }: { order: StoreOrder; now: number }) {
  useEffect(() => {
    const root = document.getElementById('root');
    root?.classList.add('print:hidden');
    return () => root?.classList.remove('print:hidden');
  }, []);

  const customer = customerLabel(order);
  const area = jobsiteArea(order);
  const shorted = order.lines.some((line) => line.fulfilledQty < line.quantity);

  return createPortal(
    <article className="hidden text-[12px] leading-snug text-black print:block" aria-hidden>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider uppercase">
            InstaSupply · {order.storeName}
          </p>
          <h1 className="text-xl font-bold">Pick slip</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold">{order.number}</p>
          <p>Placed {formatDateTimeET(order.createdAt)}</p>
          <p className="font-semibold">{promiseLabel(order, now)}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-black py-3">
        <div>
          <Heading>{order.fulfilment === 'pickup' ? 'Pickup at the counter' : 'Delivery to jobsite'}</Heading>
          <p className="mt-1 text-sm font-semibold">{customer}</p>
          {order.companyName ? <p>{order.customerName}</p> : null}
          {area ? <p>{area}</p> : null}
          {order.fulfilment === 'delivery' && order.jobsite ? <p>Site: {order.jobsite.label}</p> : null}
        </div>
        <div>
          <Heading>Load</Heading>
          <p className="mt-1">
            {pluralize(order.load.pieces, 'piece')} · {order.load.weightKg.toLocaleString('en-CA')} kg
          </p>
          {order.driver ? (
            <p className="mt-1">
              Driver: {order.driver.firstName} · {order.driver.vehicleLabel} · {order.driver.plate}
            </p>
          ) : null}
          {order.fulfilment === 'pickup' ? (
            <p className="mt-1">Check the customer&apos;s PIN at hand-over.</p>
          ) : null}
        </div>
      </section>

      <table className="mt-3 w-full border-collapse text-left">
        <thead className="table-header-group">
          <tr>
            <th colSpan={6} className="pb-1 text-left text-[11px] font-semibold">
              {order.number} · {customer}
              {area ? ` · ${area}` : ''}
            </th>
          </tr>
          <tr className="border-y-2 border-black text-[10px] tracking-wider uppercase">
            <th scope="col" className="w-7 py-1.5 text-center">
              ✓
            </th>
            <th scope="col" className="w-12 py-1.5">
              Qty
            </th>
            <th scope="col" className="py-1.5">
              SKU
            </th>
            <th scope="col" className="py-1.5">
              Item
            </th>
            <th scope="col" className="py-1.5">
              Size
            </th>
            <th scope="col" className="py-1.5 text-right">
              Line total
            </th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => {
            const short = line.fulfilledQty < line.quantity;
            return (
              <tr key={line.lineId} className="break-inside-avoid border-b border-black">
                <td className="py-2 text-center align-top">
                  <span className="inline-block size-3.5 border-2 border-black" />
                </td>
                <td className="py-2 align-top text-sm font-bold tabular-nums">
                  {line.fulfilledQty}
                  {short ? <span className="block text-[10px] font-normal">of {line.quantity}</span> : null}
                </td>
                <td className="py-2 align-top font-mono text-[11px]">{line.sku ?? 'Special order'}</td>
                <td className="py-2 align-top">
                  <span className="font-medium">{line.name}</span>
                  {line.brand ? <span> · {line.brand}</span> : null}
                  <span className="block text-[10px]">per {line.unit}</span>
                  {short ? (
                    <span className="block text-[10px] font-semibold">
                      Short: {shortReasonLabel(line.shortReason) ?? 'see order'}
                    </span>
                  ) : null}
                  {line.note ? <span className="block text-[10px]">Note: {line.note}</span> : null}
                </td>
                <td className="py-2 align-top">{line.size ?? '—'}</td>
                <td className="py-2 text-right align-top tabular-nums">{formatMoney(line.lineCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 flex break-inside-avoid items-start justify-between gap-6">
        <p>
          {pluralize(order.itemCount, 'item')} · {pluralize(order.lineCount, 'line')}
          {shorted ? ' · some lines ship short' : ''}
        </p>
        <dl className="w-60">
          <div className="flex justify-between gap-4 border-t-2 border-black pt-1 text-sm font-bold">
            <dt>Your sale</dt>
            <dd className="tabular-nums">{formatMoney(order.storeValueCents)}</dd>
          </div>
        </dl>
      </div>

      {order.instructions ? (
        <p className="mt-3 border-t border-black pt-2">
          <span className="font-semibold">Site instructions:</span> {order.instructions}
        </p>
      ) : null}

      <footer className="mt-12 grid break-inside-avoid grid-cols-2 gap-12">
        <p className="border-t border-black pt-1">Picked by</p>
        <p className="border-t border-black pt-1">Checked by</p>
      </footer>
    </article>,
    document.body,
  );
}
