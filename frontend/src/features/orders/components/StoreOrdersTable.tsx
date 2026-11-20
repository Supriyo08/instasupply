import { formatMoney, formatRelativeTime, type StoreOrder } from '@instasupply/shared';
import { Link } from 'react-router';

import { ChevronRightIcon } from '@/components/ui/icons';

import { destinationLabel, orderHref } from '../order-format';
import { AttentionBadge, FulfilmentBadge, StoreOrderStatusBadge } from './OrderBadges';
import { StoreOrderTimer, driverChip } from './StoreOrderCard';

/** Store orders across stores with their SLA timers (MARKETPLACE §9 "Store orders" tab). */
export function StoreOrdersTable({
  storeOrders,
  now,
  showStore = true,
}: {
  storeOrders: StoreOrder[];
  now: number;
  showStore?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Store orders, newest first</caption>
        <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Store order
            </th>
            {showStore ? (
              <th scope="col" className="px-3 py-3 font-medium">
                Store
              </th>
            ) : null}
            <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">
              Customer
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
              SLA
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Total
            </th>
            <th scope="col" className="w-10 py-3 pr-5">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {storeOrders.map((so) => (
            <tr key={so.id} className="transition-colors hover:bg-slate-50">
              <td className="px-5 py-3 align-top">
                <Link
                  to={orderHref(so.orderId)}
                  className="font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
                >
                  {so.number}
                </Link>
                <p className="mt-1 text-xs whitespace-nowrap text-slate-400">
                  {formatRelativeTime(so.createdAt, now)}
                </p>
              </td>
              {showStore ? (
                <td className="max-w-48 px-3 py-3 align-top">
                  <p className="truncate font-medium text-slate-900">{so.storeName}</p>
                  <p className="truncate text-xs text-slate-500">{so.itemsSummary}</p>
                </td>
              ) : null}
              <td className="hidden max-w-56 px-3 py-3 align-top md:table-cell">
                <p className="truncate text-slate-900">{so.companyName ?? so.customerName}</p>
                <p className="truncate text-xs text-slate-500">{destinationLabel(so)}</p>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="flex flex-wrap gap-1.5">
                  <StoreOrderStatusBadge status={so.status} />
                  <FulfilmentBadge fulfilment={so.fulfilment} />
                  {so.acceptOverdue ? <AttentionBadge label="Overdue" /> : null}
                </div>
                {so.driver ? (
                  <p className="mt-1 truncate text-xs text-slate-500">{driverChip(so.driver)}</p>
                ) : null}
                <p className="mt-1 text-xs lg:hidden">
                  <StoreOrderTimer storeOrder={so} />
                </p>
              </td>
              <td className="hidden px-3 py-3 align-top text-xs lg:table-cell">
                <StoreOrderTimer storeOrder={so} />
              </td>
              <td className="px-3 py-3 text-right align-top tabular-nums">
                {formatMoney(so.current.totalCents)}
              </td>
              <td className="py-3 pr-5 align-top text-slate-300">
                <ChevronRightIcon size={16} aria-hidden />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
