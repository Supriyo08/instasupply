import { STATUS_META, formatDateTime } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';

import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { PackageIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { LinkedOrderCard } from '@/features/orders/components/LinkedOrderCard';
import { presenceOf, useDriverLocations, useDrivers, useNow, useRoute } from '@/lib/data';

import { useDelivery, useDeliveryEvents, usePrivateMeta } from '../hooks';
import { AssignmentPanel } from './AssignmentPanel';
import { DeliveryMap } from './DeliveryMap';
import { DeliverySummary } from './DeliverySummary';
import { EditDeliveryModal } from './EditDeliveryModal';
import { OutcomeCard } from './ProofCard';
import { StaffActions } from './StaffActions';
import { Timeline } from './Timeline';
import { TrackingCard } from './TrackingCard';

export default function DeliveryDetailPage() {
  const { deliveryId } = useParams();
  const now = useNow(15_000);
  const delivery = useDelivery(deliveryId);
  const events = useDeliveryEvents(deliveryId);
  const meta = usePrivateMeta(deliveryId);
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const driverId = delivery.data?.driverId ?? null;
  const route = useRoute(driverId);
  const [editing, setEditing] = useState(false);

  const driver = useMemo(
    () => drivers.data.find((item) => item.id === driverId) ?? null,
    [driverId, drivers.data],
  );
  const location = useMemo(
    () => locations.data.find((item) => item.id === driverId) ?? null,
    [driverId, locations.data],
  );

  if (delivery.loading && !delivery.data) return <PageSpinner label="Loading delivery" />;
  if (delivery.error) return <ErrorState error={delivery.error} />;
  if (!delivery.data) {
    return (
      <EmptyState icon={PackageIcon} title="Delivery not found" description="It may have been removed." />
    );
  }

  const record = delivery.data;
  const presence = presenceOf(location, now);

  return (
    <>
      <PageHeader
        back={{ to: '/deliveries', label: 'Deliveries' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{record.orderId}</span>
            <StatusBadge status={record.status} />
            <PriorityBadge priority={record.priority} />
          </span>
        }
        description={`${STATUS_META[record.status].description} · created ${formatDateTime(record.createdAt)}`}
        actions={<StaffActions delivery={record} onEdit={() => setEditing(true)} />}
      />

      {/* On wide screens: details left, driver/tracking right. Stacked: driver panel before the timeline. */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-6">
          <DeliveryMap delivery={record} driverLocation={location} presence={presence} route={route.data} />
          <DeliverySummary delivery={record} />
        </div>

        <div className="space-y-6 xl:row-span-2">
          <OutcomeCard delivery={record} />
          {record.sourceOrderId ? <LinkedOrderCard orderId={record.sourceOrderId} /> : null}
          <AssignmentPanel
            delivery={record}
            driver={driver}
            location={location}
            presence={presence}
            route={route.data}
            now={now}
          />
          <TrackingCard delivery={record} meta={meta.data} loading={meta.loading} />
        </div>

        <Card className="min-w-0 xl:col-start-1">
          <CardHeader title="Timeline" description="Every change, who made it and when." />
          <CardBody>
            {events.error ? <ErrorState error={events.error} /> : <Timeline events={events.data} now={now} />}
          </CardBody>
        </Card>
      </div>

      {editing ? <EditDeliveryModal delivery={record} open onClose={() => setEditing(false)} /> : null}
    </>
  );
}
