import { STATUS_META, type Delivery } from '@instasupply/shared';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Feedback';
import { ChevronRightIcon, TruckIcon } from '@/components/ui/icons';
import type { OrderRecord } from '@/lib/data';
import type { DocumentState } from '@/lib/firebase/hooks';

import { OrderProgress } from './OrderProgress';

/** Live status and driver of the delivery that fulfils the order. */
function LiveDelivery({ delivery }: { delivery: DocumentState<Delivery> }) {
  if (delivery.loading && !delivery.data) return <Skeleton className="h-14 w-full rounded-xl" />;
  if (delivery.error) {
    return <p className="text-sm text-rose-700">Couldn't load the delivery: {delivery.error.message}</p>;
  }
  if (!delivery.data) return <p className="text-sm text-slate-500">The linked delivery no longer exists.</p>;

  const record = delivery.data;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
      {record.driverId ? (
        <Avatar name={record.driverName} size="sm" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
          <TruckIcon size={14} aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {record.driverId ? (
            <Link to={`/drivers/${record.driverId}`} className="hover:text-brand-700">
              {record.driverName ?? 'Driver'}
            </Link>
          ) : (
            'No driver yet'
          )}
        </p>
        <p className="truncate text-xs text-slate-500">{STATUS_META[record.status].description}</p>
      </div>
      <StatusBadge status={record.status} />
    </div>
  );
}

export function FulfilmentCard({
  order,
  delivery,
}: {
  order: OrderRecord;
  delivery: DocumentState<Delivery>;
}) {
  return (
    <Card>
      <CardHeader
        title="Fulfilment"
        description="Follows the linked delivery automatically."
        action={
          <Link
            to={`/deliveries/${order.deliveryId}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            View delivery <ChevronRightIcon size={14} aria-hidden />
          </Link>
        }
      />
      <CardBody className="space-y-5">
        <LiveDelivery delivery={delivery} />
        <OrderProgress order={order} delivery={delivery.data} />
      </CardBody>
    </Card>
  );
}
