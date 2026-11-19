import { formatCurrency, formatDateTime, formatRelativeTime, pluralize } from '@instasupply/shared';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { Skeleton } from '@/components/ui/Feedback';
import { ChevronRightIcon } from '@/components/ui/icons';
import type { OrderRecord } from '@/lib/data';

import { itemNames } from '../order-format';
import { OrderStatusBadge, PaymentBadge } from './OrderBadges';

const orderPath = (order: OrderRecord) => `/orders/${order.id}`;

/** Orders as a dense table on wider screens and a stacked list on phones. */
export function OrdersTable({ orders, now }: { orders: OrderRecord[]; now: number }) {
  const navigate = useNavigate();

  // The order number is each row's real link (keyboard, screen readers, open in new tab). A click
  // anywhere else on the row follows it too, unless the user was selecting text (e.g. a phone).
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, order: OrderRecord) => {
    if ((event.target as Element).closest('a, button')) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(orderPath(order), '_blank', 'noopener');
    else navigate(orderPath(order));
  };

  return (
    <>
      <ul className="divide-y divide-slate-100 sm:hidden">
        {orders.map((order) => (
          <li key={order.id}>
            <Link to={orderPath(order)} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[13px] font-semibold text-slate-900">{order.number}</span>
                  <span className="text-sm font-medium text-slate-900 tabular-nums">
                    {formatCurrency(order.total)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-slate-500">
                  <span className="truncate">
                    {order.customerName} · {order.address.city}
                  </span>
                  <span className="shrink-0">{formatRelativeTime(order.createdAt, now)}</span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <OrderStatusBadge status={order.status} />
                  <PaymentBadge order={order} />
                  <span className="text-xs text-slate-400">{pluralize(order.itemCount, 'item')}</span>
                </span>
              </span>
              <ChevronRightIcon size={16} className="mt-0.5 shrink-0 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Orders, newest first</caption>
          <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">
                Order
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Customer
              </th>
              <th scope="col" className="hidden px-3 py-3 font-medium xl:table-cell">
                Items
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                Total
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="w-10 py-3 pr-5">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((order) => (
              <tr
                key={order.id}
                onClick={(event) => onRowClick(event, order)}
                className="cursor-pointer transition-colors focus-within:bg-slate-50 hover:bg-slate-50"
              >
                <td className="px-5 py-3 align-top">
                  <Link
                    to={orderPath(order)}
                    className="rounded font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
                  >
                    {order.number}
                  </Link>
                  <p
                    className="mt-1 text-xs whitespace-nowrap text-slate-400"
                    title={formatDateTime(order.createdAt)}
                  >
                    {formatRelativeTime(order.createdAt, now)}
                    <span className="xl:hidden"> · {pluralize(order.itemCount, 'item')}</span>
                  </p>
                </td>
                <td className="max-w-56 px-3 py-3 align-top">
                  <p className="truncate font-medium text-slate-900">{order.customerName}</p>
                  <p className="text-xs whitespace-nowrap text-slate-500">{order.address.phone}</p>
                  <p className="truncate text-xs text-slate-400">{order.address.city}</p>
                </td>
                <td className="hidden max-w-xs px-3 py-3 align-top xl:table-cell">
                  <p className="text-slate-700">{pluralize(order.itemCount, 'item')}</p>
                  <p className="truncate text-xs text-slate-400">{itemNames(order, 2)}</p>
                </td>
                <td className="px-3 py-3 text-right align-top">
                  <p className="font-medium text-slate-900 tabular-nums">{formatCurrency(order.total)}</p>
                  <PaymentBadge order={order} className="mt-1" />
                </td>
                <td className="px-3 py-3 align-top">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="py-3 pr-5 align-top text-slate-300">
                  <ChevronRightIcon size={16} aria-hidden />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function OrdersTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100" aria-busy="true">
      <span role="status" className="sr-only">
        Loading orders…
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-4">
          <div className="w-24 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden h-4 w-20 sm:block" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}
