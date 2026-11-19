import {
  formatDate,
  formatDistance,
  formatDuration,
  formatEta,
  formatRelativeTime,
  isActiveStatus,
  startOfDay,
  toMillis,
  VEHICLE_META,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import {
  ApproveIcon,
  MessageIcon,
  PackageIcon,
  RefreshIcon,
  SuspendIcon,
  TruckIcon,
} from '@/components/ui/icons';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { DeliveriesTable } from '@/features/deliveries/components/DeliveriesTable';
import { FleetMap } from '@/features/live-map/FleetMap';
import { presenceOf, useNow, useRoute, type DriverRecord } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

import { DriverStatusDialog, type DriverStatusAction } from './DriverStatusDialog';
import { useDriver, useDriverDeliveries, useDriverLocation, useDriverTotals } from './hooks';

const PRESENCE_LABEL = { online: 'Online now', stale: 'No recent signal', offline: 'Offline' };

export default function DriverDetailPage() {
  const { driverId } = useParams();
  const now = useNow(15_000);
  const toast = useToast();
  const { isAdmin } = useAuth();
  const driver = useDriver(driverId);
  const location = useDriverLocation(driverId);
  const route = useRoute(driverId);
  const deliveries = useDriverDeliveries(driverId);
  const totals = useDriverTotals(driverId);
  const [planning, setPlanning] = useState(false);
  const [dialog, setDialog] = useState<DriverStatusAction | null>(null);

  const today = startOfDay(now);
  const stats = useMemo(() => {
    const active = deliveries.data.filter((delivery) => isActiveStatus(delivery.status));
    const deliveredToday = deliveries.data.filter(
      (delivery) => delivery.status === 'delivered' && (toMillis(delivery.deliveredAt) ?? 0) >= today,
    );
    return { active, deliveredToday };
  }, [deliveries.data, today]);

  if (driver.loading && !driver.data) return <PageSpinner label="Loading driver" />;
  if (driver.error) return <ErrorState error={driver.error} />;
  if (!driver.data || driver.data.role !== 'driver') {
    return <EmptyState icon={TruckIcon} title="Driver not found" />;
  }

  const profile = driver.data as DriverRecord;
  const presence = profile.status === 'active' ? presenceOf(location.data, now) : 'offline';
  const successRate =
    totals && totals.delivered + totals.failed > 0
      ? Math.round((totals.delivered / (totals.delivered + totals.failed)) * 100)
      : null;
  const elapsed = route.data ? (now - (toMillis(route.data.computedAt) ?? now)) / 1000 : 0;

  const replan = async () => {
    setPlanning(true);
    try {
      const result = await call('optimizeRoute', { driverId: profile.id });
      toast.success('Route re-optimized', `${result.stops} stops · ${formatDuration(result.totalSeconds)}`);
    } catch (error) {
      toast.error("Couldn't optimize the route", errorMessage(error));
    } finally {
      setPlanning(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: '/drivers', label: 'Drivers' }}
        title={
          <span className="flex items-center gap-3">
            <Avatar
              name={profile.displayName}
              presence={profile.status === 'active' ? presence : undefined}
              size="lg"
            />
            <span>
              {profile.displayName}
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal">
                {profile.status === 'pending' ? <Badge tone="warning">Pending approval</Badge> : null}
                {profile.status === 'suspended' ? <Badge tone="danger">Suspended</Badge> : null}
                {profile.status === 'active' ? (
                  <Badge tone={presence === 'online' ? 'success' : 'neutral'} dot>
                    {PRESENCE_LABEL[presence]}
                  </Badge>
                ) : null}
                <span className="text-slate-500">
                  {profile.vehicle
                    ? `${VEHICLE_META[profile.vehicle.type]?.label} · ${profile.vehicle.plate}`
                    : 'No vehicle'}
                  {' · '}joined {formatDate(profile.createdAt)}
                </span>
              </span>
            </span>
          </span>
        }
        actions={
          <>
            <Link
              to={`/messages/${profile.id}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
            >
              <MessageIcon size={16} aria-hidden /> Message
            </Link>
            {isAdmin && profile.status === 'pending' ? (
              <Button icon={ApproveIcon} onClick={() => setDialog('approve')}>
                Approve
              </Button>
            ) : null}
            {isAdmin && profile.status === 'active' ? (
              <Button variant="secondary" icon={SuspendIcon} onClick={() => setDialog('suspend')}>
                Suspend
              </Button>
            ) : null}
            {isAdmin && profile.status === 'suspended' ? (
              <Button icon={ApproveIcon} onClick={() => setDialog('reactivate')}>
                Reactivate
              </Button>
            ) : null}
          </>
        }
      />

      {profile.status === 'suspended' && profile.suspendedReason ? (
        <p className="-mt-3 mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
          Suspended: {profile.suspendedReason}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Active stops" value={stats.active.length} icon={PackageIcon} />
        <StatCard
          label="Delivered today"
          value={stats.deliveredToday.length}
          icon={ApproveIcon}
          tone="success"
        />
        <StatCard label="All-time delivered" value={totals?.delivered ?? '—'} icon={TruckIcon} tone="info" />
        <StatCard
          label="Success rate"
          value={successRate != null ? `${successRate}%` : '—'}
          hint={totals ? `${totals.failed} failed` : undefined}
          icon={SuspendIcon}
          tone="warning"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Current route"
            description={
              route.data?.stops.length
                ? `${route.data.stops.length} stops · ${formatDuration(route.data.totalSeconds)} · ${formatDistance(route.data.totalMeters)} · planned ${formatRelativeTime(route.data.computedAt, now)}`
                : 'No planned stops'
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshIcon}
                loading={planning}
                onClick={() => void replan()}
                disabled={profile.status !== 'active'}
              >
                Re-optimize
              </Button>
            }
          />
          <div className="h-96">
            <FleetMap
              drivers={[profile]}
              locations={location.data ? [location.data] : []}
              deliveries={stats.active}
              now={now}
              selectedDriverId={profile.id}
              route={route.data}
              showUnassigned={false}
              scrollWheelZoom={false}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Stops in order" />
          {route.data?.stops.length ? (
            <ol className="divide-y divide-slate-100">
              {route.data.stops.map((stop, index) => (
                <li key={stop.deliveryId}>
                  <Link
                    to={`/deliveries/${stop.deliveryId}`}
                    className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {stop.customerName}
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-slate-700 tabular-nums">
                          {formatEta(stop.arrivalOffsetSeconds - elapsed, now)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{stop.address}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <StatusBadge status={stop.status} />
                        <span className="text-[11px] text-slate-400">
                          {formatDistance(stop.legMeters)} · {formatDuration(stop.legSeconds)}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={PackageIcon} title="No stops right now" className="py-10" />
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent deliveries" description="Latest 50 deliveries assigned to this driver." />
        {deliveries.error ? (
          <ErrorState error={deliveries.error} className="m-5" />
        ) : deliveries.data.length === 0 ? (
          <EmptyState icon={PackageIcon} title="No deliveries yet" className="py-10" />
        ) : (
          <DeliveriesTable deliveries={deliveries.data} now={now} onAssign={() => undefined} />
        )}
      </Card>

      <DriverStatusDialog driver={dialog ? profile : null} action={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
