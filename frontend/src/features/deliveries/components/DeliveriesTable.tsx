import { formatRelativeTime } from '@instasupply/shared';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge, PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { KeyIcon, StoreIcon } from '@/components/ui/icons';
import { Money } from '@/components/ui/Money';
import type { DeliveryRecord } from '@/lib/data';

import { KIND_LABEL, OFFER_STATUS_META, vehicleClassLabel } from '../delivery-format';

/**
 * Deliveries with the marketplace columns of MARKETPLACE §9: kind, pickup store, vehicle class, driver
 * payout and job-offer status. Each order number is a link, so the table works from the keyboard.
 */
export function DeliveriesTable({
  deliveries,
  now,
  onAssign,
}: {
  deliveries: DeliveryRecord[];
  now: number;
  /** Omit to hide the Assign buttons (a driver's own history). */
  onAssign?: (delivery: DeliveryRecord) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Deliveries</caption>
        <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Order
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Pickup → site
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
              Class
            </th>
            <th scope="col" className="hidden px-3 py-3 text-right font-medium lg:table-cell">
              Payout
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
          {deliveries.map((delivery) => {
            const offer = delivery.offerStatus ? OFFER_STATUS_META[delivery.offerStatus] : null;
            return (
              <tr key={delivery.id} className="transition-colors hover:bg-slate-50">
                <td className="px-5 py-3 align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      to={`/deliveries/${delivery.id}`}
                      className="font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
                    >
                      {delivery.orderId}
                    </Link>
                    <PriorityBadge priority={delivery.priority} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs whitespace-nowrap text-slate-400">
                    <span>{KIND_LABEL[delivery.kind]}</span>
                    <span>
                      {delivery.load
                        ? `${delivery.load.pieces} pcs · ${delivery.load.weightKg} kg`
                        : `${delivery.packageCount} pcs`}
                    </span>
                    {delivery.requireCode ? (
                      <span className="inline-flex items-center gap-1" title="Hand-off code required">
                        <KeyIcon size={12} aria-hidden /> Code
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-64 px-3 py-3 align-top">
                  {delivery.pickup ? (
                    <p className="flex items-center gap-1 truncate text-xs font-medium text-amber-800">
                      <StoreIcon size={12} className="shrink-0" aria-hidden /> {delivery.pickup.storeName}
                    </p>
                  ) : null}
                  <p className="truncate font-medium text-slate-900">{delivery.customer.name}</p>
                  <p className="truncate text-xs text-slate-500">{delivery.address}</p>
                </td>
                <td className="hidden px-3 py-3 align-top text-slate-600 lg:table-cell">
                  {vehicleClassLabel(delivery.vehicleClass)}
                  {delivery.tripKm != null ? (
                    <span className="block text-xs text-slate-400">{delivery.tripKm.toFixed(1)} km</span>
                  ) : null}
                </td>
                <td className="hidden px-3 py-3 text-right align-top text-slate-700 lg:table-cell">
                  <Money cents={delivery.payout?.totalCents} />
                </td>
                <td className="px-3 py-3 align-top">
                  {delivery.driverId ? (
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={delivery.driverName} size="sm" />
                      <span className="text-slate-700">{delivery.driverName}</span>
                    </div>
                  ) : delivery.status === 'unassigned' && onAssign ? (
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => onAssign(delivery)}
                      aria-label={`Assign ${delivery.orderId}`}
                    >
                      Assign
                    </Button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  <StatusBadge status={delivery.status} />
                  {offer && delivery.status === 'unassigned' ? (
                    <p className="mt-1">
                      <Badge tone={offer.tone}>{offer.label}</Badge>
                    </p>
                  ) : null}
                  {delivery.declinedBy?.length && delivery.status === 'unassigned' ? (
                    <p className="mt-1 text-xs text-rose-600">Declined {delivery.declinedBy.length}×</p>
                  ) : null}
                </td>
                <td className="hidden px-5 py-3 text-right align-top text-xs whitespace-nowrap text-slate-500 xl:table-cell">
                  {formatRelativeTime(delivery.updatedAt, now)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
