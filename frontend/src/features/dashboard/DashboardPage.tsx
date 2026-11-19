import { ACTIVE_STATUSES, toMillis } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  FailedIcon,
  LiveIcon,
  MapIcon,
  PackageIcon,
  SuccessIcon,
  TruckIcon,
  UploadIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { ImportCsvModal } from '@/features/deliveries/import/ImportCsvModal';
import { FleetMap } from '@/features/live-map/FleetMap';
import { useFleet } from '@/features/live-map/useFleet';
import { presenceOf, useActivity, useClosedToday, useNow } from '@/lib/data';

import { ActivityFeed } from './ActivityFeed';
import { NeedsAttention, buildAttentionItems } from './NeedsAttention';
import { StoreSummary } from './StoreSummary';

const greeting = (hour: number) =>
  hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

export default function DashboardPage() {
  const now = useNow(15_000);
  const { displayName } = useSignedInUser();
  const fleet = useFleet();
  const closed = useClosedToday();
  const activity = useActivity(20);
  const [importOpen, setImportOpen] = useState(false);

  const stats = useMemo(() => {
    const active = fleet.openDeliveries.filter((delivery) => ACTIVE_STATUSES.includes(delivery.status));
    const unassigned = fleet.openDeliveries.filter((delivery) => delivery.status === 'unassigned');
    const delivered = closed.data.filter((delivery) => delivery.status === 'delivered');
    const failed = closed.data.filter((delivery) => delivery.status === 'failed');
    const onTime = delivered.filter((delivery) => {
      const end = toMillis(delivery.windowEnd);
      const at = toMillis(delivery.deliveredAt);
      return end == null || (at != null && at <= end);
    });
    const online = fleet.rows.filter((row) => presenceOf(row.location, now) === 'online').length;
    return { active, unassigned, delivered, failed, onTime, online };
  }, [closed.data, fleet.openDeliveries, fleet.rows, now]);

  const attention = useMemo(
    () =>
      buildAttentionItems({
        open: fleet.openDeliveries,
        failedToday: stats.failed,
        pendingDrivers: fleet.allDrivers.filter((driver) => driver.status === 'pending'),
        fleet: fleet.rows,
        now,
      }),
    [fleet.allDrivers, fleet.openDeliveries, fleet.rows, now, stats.failed],
  );

  const firstName = displayName.split(' ')[0];
  const onTimeRate = stats.delivered.length
    ? Math.round((stats.onTime.length / stats.delivered.length) * 100)
    : null;

  return (
    <>
      <PageHeader
        title={`${greeting(new Date(now).getHours())}, ${firstName}`}
        description={new Date(now).toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        actions={
          <Button variant="secondary" icon={UploadIcon} onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="In progress"
          value={stats.active.length}
          hint="Assigned to drivers"
          icon={PackageIcon}
          to="/deliveries?tab=active"
        />
        <StatCard
          label="Unassigned"
          value={stats.unassigned.length}
          hint={stats.unassigned.length ? 'Waiting for a driver' : 'Queue is empty'}
          icon={WarningIcon}
          tone="warning"
          to="/deliveries?tab=unassigned"
        />
        <StatCard
          label="Delivered today"
          value={stats.delivered.length}
          hint={onTimeRate != null ? `${onTimeRate}% on time` : 'No deliveries yet'}
          icon={SuccessIcon}
          tone="success"
          to="/deliveries?tab=delivered"
        />
        <StatCard
          label="Failed today"
          value={stats.failed.length}
          hint="Retry or cancel"
          icon={FailedIcon}
          tone="danger"
          to="/deliveries?tab=failed"
        />
        <StatCard
          label="Drivers online"
          value={
            <>
              {stats.online}
              <span className="text-base font-medium text-slate-400"> / {fleet.rows.length}</span>
            </>
          }
          hint="Sharing live location"
          icon={TruckIcon}
          tone="info"
          to="/live"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <LiveIcon size={14} className="text-emerald-500" aria-hidden /> Live fleet
              </span>
            }
            description="Drivers and open deliveries, updating in real time."
            action={
              <Link
                to="/live"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <MapIcon size={14} aria-hidden /> Full map
              </Link>
            }
          />
          <div className="h-[420px]">
            <FleetMap
              drivers={fleet.drivers}
              locations={fleet.locations}
              deliveries={fleet.openDeliveries}
              now={now}
              scrollWheelZoom={false}
            />
          </div>
        </Card>
        <NeedsAttention items={attention} />
        <StoreSummary now={now} className="xl:col-span-2" />
      </div>

      <div className="mt-6">
        <ActivityFeed activity={activity} now={now} />
      </div>

      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
