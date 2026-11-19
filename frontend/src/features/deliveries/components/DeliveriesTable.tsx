import { formatCurrency, formatRelativeTime } from '@instasupply/shared';
import { useNavigate } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CashIcon, KeyIcon } from '@/components/ui/icons';
import type { DeliveryRecord } from '@/lib/data';

export function DeliveriesTable({
  deliveries,
  now,
  onAssign,
}: {
  deliveries: DeliveryRecord[];
  now: number;
  onAssign: (delivery: DeliveryRecord) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Order
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Customer
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium xl:table-cell">
              Drop-off
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Driver
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="hidden px-5 py-3 text-right font-medium xl:table-cell">
              Updated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {deliveries.map((delivery) => (
            <tr
              key={delivery.id}
              onClick={() => navigate(`/deliveries/${delivery.id}`)}
              className="cursor-pointer transition-colors hover:bg-slate-50"
            >
              <td className="px-5 py-3 align-top">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[13px] font-semibold text-slate-900">
                    {delivery.orderId}
                  </span>
                  <PriorityBadge priority={delivery.priority} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs whitespace-nowrap text-slate-400">
                  <span>{delivery.packageCount} pkg</span>
                  {delivery.codAmount ? (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <CashIcon size={12} aria-hidden /> {formatCurrency(delivery.codAmount)}
                    </span>
                  ) : null}
                  {delivery.requireCode ? (
                    <span className="inline-flex items-center gap-1" title="Hand-off code required">
                      <KeyIcon size={12} aria-hidden /> Code
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="max-w-56 px-3 py-3 align-top">
                <p className="truncate font-medium text-slate-900">{delivery.customer.name}</p>
                <p className="text-xs text-slate-500">{delivery.customer.phone ?? '—'}</p>
                <p className="truncate text-xs text-slate-400 xl:hidden">{delivery.address}</p>
              </td>
              <td className="hidden max-w-xs px-3 py-3 align-top xl:table-cell">
                <p className="truncate text-slate-700">{delivery.address}</p>
                {delivery.addressNotes ? (
                  <p className="truncate text-xs text-slate-400">{delivery.addressNotes}</p>
                ) : null}
              </td>
              <td className="px-3 py-3 align-top">
                {delivery.driverId ? (
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={delivery.driverName} size="sm" />
                    <span className="text-slate-700">{delivery.driverName}</span>
                  </div>
                ) : delivery.status === 'cancelled' ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAssign(delivery);
                    }}
                  >
                    Assign
                  </Button>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <StatusBadge status={delivery.status} />
                {delivery.declinedBy?.length && delivery.status === 'unassigned' ? (
                  <p className="mt-1 text-xs text-rose-600">Declined {delivery.declinedBy.length}×</p>
                ) : null}
              </td>
              <td className="hidden px-5 py-3 text-right align-top text-xs whitespace-nowrap text-slate-500 xl:table-cell">
                {formatRelativeTime(delivery.updatedAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
