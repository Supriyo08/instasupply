import { customerLabelFor, formatDateTimeET, STATUS_META } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';

import { Badge, PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Layout';
import { isNetworkError } from '@/lib/api';
import { presenceOf, useDriverLocations, useDrivers, useNow, useRoute } from '@/lib/data';

import { SceneEmpty } from '../components/SceneArt';
import { KIND_LABEL } from '../delivery-format';
import { useDelivery, useDeliveryEvents, usePrivateMeta } from '../hooks';
import { AssignmentPanel } from './AssignmentPanel';
import { DeliveryMap } from './DeliveryMap';
import { DeliverySummary } from './DeliverySummary';
import { EditDeliveryModal } from './EditDeliveryModal';
import { LinkedStoreOrderCard, LoadCard, PayoutCard, PickupCard, UnloadCard } from './MarketplaceCards';
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
  if (!delivery.data) {
    // "Not found" only when the server said so; a dropped connection offers a retry (R55).
    if (delivery.error) {
      return (
        <ErrorState
          error={delivery.error}
          onRetry={delivery.retry}
          title={isNetworkError(delivery.error) ? "Can't reach the server" : "Couldn't load this delivery"}
        />
      );
    }
    return (
      <SceneEmpty
        artKey="scene-report-issue"
        title="Delivery not found"
        description="The link may be wrong, or the delivery was removed."
      />
    );
  }

  const record = delivery.data;
  const presence = presenceOf(location, now);
  const label =
    record.kind === 'marketplace'
      ? customerLabelFor(record.status, record.kind)
      : STATUS_META[record.status].description;

  return (
    <>
      <PageHeader
        back={{ to: '/deliveries', label: 'Deliveries' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{record.orderId}</span>
            <StatusBadge status={record.status} />
            <PriorityBadge priority={record.priority} />
            <Badge tone="neutral">{KIND_LABEL[record.kind]}</Badge>
          </span>
        }
        description={`${label} · created ${formatDateTimeET(record.createdAt, now)}`}
        actions={<StaffActions delivery={record} onEdit={() => setEditing(true)} />}
      />

      {/* Wide: details left, dispatch right. Stacked: the driver panel comes before the long cards. */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <DeliveryMap delivery={record} driverLocation={location} presence={presence} route={route.data} />
          <div className="space-y-6 xl:hidden">
            <OutcomeCard delivery={record} now={now} />
            <AssignmentPanel
              delivery={record}
              driver={driver}
              location={location}
              presence={presence}
              route={route.data}
              now={now}
            />
          </div>
          <PickupCard delivery={record} now={now} />
          <DeliverySummary delivery={record} now={now} />
          <LoadCard delivery={record} />
          <Card className="min-w-0">
            <CardHeader title="Timeline" description="Every change, who made it and when." />
            <CardBody>
              {events.error && events.data.length === 0 ? (
                <ErrorState error={events.error} onRetry={events.retry} />
              ) : events.loading && events.data.length === 0 ? (
                <PageSpinner label="Loading the timeline" />
              ) : (
                <Timeline events={events.data} now={now} />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <div className="hidden space-y-6 xl:block">
            <OutcomeCard delivery={record} now={now} />
            <AssignmentPanel
              delivery={record}
              driver={driver}
              location={location}
              presence={presence}
              route={route.data}
              now={now}
            />
          </div>
          <UnloadCard delivery={record} />
          <PayoutCard delivery={record} />
          <LinkedStoreOrderCard delivery={record} now={now} />
          <TrackingCard delivery={record} meta={meta.data} loading={meta.loading} />
        </div>
      </div>

      {editing ? <EditDeliveryModal delivery={record} open onClose={() => setEditing(false)} /> : null}
    </>
  );
}
