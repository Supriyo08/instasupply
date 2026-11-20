import {
  formatClockET,
  formatDateTimeET,
  formatDistance,
  formatDuration,
  formatRelativeTime,
  isActiveStatus,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import {
  ApproveIcon,
  FailedIcon,
  MessageIcon,
  PackageIcon,
  RefreshIcon,
  SuccessIcon,
  SuspendIcon,
  TruckIcon,
} from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { KpiTile } from '@/features/dashboard/KpiTile';
import { DeliveriesTable } from '@/features/deliveries/components/DeliveriesTable';
import { SceneEmpty } from '@/features/deliveries/components/SceneArt';
import { cityName, vehicleClassLabel } from '@/features/deliveries/delivery-format';
import { FleetMap } from '@/features/live-map/FleetMap';
import { SessionsPanel } from '@/features/team/SessionsPanel';
import { call, errorMessage, isNetworkError } from '@/lib/api';
import { presenceOf, useNow, useRoute, useStartOfToday, type DriverRecord } from '@/lib/data';

import { ComplianceCard, EarningsCard, PayoutAccountCard, VehicleCard } from './DriverCards';
import { DriverStatusDialog, type DriverStatusAction } from './DriverStatusDialog';
import { useDriver, useDriverDeliveries, useDriverLocation, useDriverTotals } from './hooks';

const PRESENCE_LABEL = { online: 'Online now', stale: 'No recent signal', offline: 'Offline' };

export default function DriverDetailPage() {
  const { driverId } = useParams();
  const now = useNow(15_000);
  const today = useStartOfToday();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const driver = useDriver(driverId);
  const location = useDriverLocation(driverId);
  const route = useRoute(driverId);
  const deliveries = useDriverDeliveries(driverId);
  const totals = useDriverTotals(driverId);
  const [planning, setPlanning] = useState(false);
  const [dialog, setDialog] = useState<DriverStatusAction | null>(null);

  const stats = useMemo(() => {
    const active = deliveries.data.filter((delivery) => isActiveStatus(delivery.status));
    const deliveredToday = deliveries.data.filter(
      (delivery) => delivery.status === 'delivered' && (delivery.deliveredAt ?? 0) >= today,
    );
    return { active, deliveredToday };
  }, [deliveries.data, today]);

  if (driver.loading && !driver.data) return <PageSpinner label="Loading driver" />;
  if (!driver.data || driver.data.role !== 'driver') {
    if (driver.error) {
      return (
        <ErrorState
          error={driver.error}
          onRetry={driver.retry}
          title={isNetworkError(driver.error) ? "Can't reach the server" : "Couldn't load this driver"}
        />
      );
    }
    return (
      <SceneEmpty artKey="scene-welcome" title="Driver not found" description="The link may be wrong." />
    );
  }

  const profile: DriverRecord = driver.data;
  const presence = profile.status === 'active' ? presenceOf(location.data, now) : 'offline';
  const counts = totals.data;
  const finished = counts.delivered + counts.failed;
  const successRate = finished > 0 ? Math.round((counts.delivered / finished) * 100) : null;
  const elapsed = route.data ? (now - route.data.computedAt) / 1000 : 0;
  const stops = route.data?.stops ?? [];
  const vehicle = profile.vehicle ?? profile.vehicleDraft ?? null;

  const replan = async () => {
    setPlanning(true);
    try {
      const result = await call('optimizeRoute', { driverId: profile.id });
      toast.success('Route re-planned', `${result.stops} stops · ${formatDuration(result.totalSeconds)}`);
    } catch (error) {
      toast.error("Couldn't re-plan the route", errorMessage(error));
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
                {profile.vehicleReviewRequired ? <Badge tone="warning">Vehicle review</Badge> : null}
                <span className="text-slate-500">
                  {cityName(profile.cityId)}
                  {vehicle
                    ? ` · ${vehicleClassLabel(vehicle.capacityClass)} · ${vehicle.plate}`
                    : ' · No vehicle'}
                  {profile.createdAt ? ` · joined ${formatDateTimeET(profile.createdAt, now)}` : ''}
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
                Review & approve
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

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label="Active jobs"
          value={stats.active.length}
          icon={PackageIcon}
          loading={deliveries.loading && deliveries.data.length === 0}
        />
        <KpiTile
          label="Delivered today"
          value={stats.deliveredToday.length}
          icon={SuccessIcon}
          tone="success"
        />
        <KpiTile
          label="All-time delivered"
          value={counts.delivered}
          icon={TruckIcon}
          tone="info"
          loading={totals.loading}
          failed={!!totals.error}
        />
        <KpiTile
          label="Success rate"
          value={successRate != null ? `${successRate}%` : '—'}
          hint={`${counts.failed} failed`}
          icon={FailedIcon}
          tone="warning"
          loading={totals.loading}
          failed={!!totals.error}
        />
      </section>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <CardHeader
              title="Current route"
              description={
                stops.length
                  ? `${stops.length} stops · ${formatDuration(route.data!.totalSeconds)} · ${formatDistance(route.data!.totalMeters)} · planned ${formatRelativeTime(route.data!.computedAt, now)}`
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
                  Re-plan
                </Button>
              }
            />
            <div
              className="h-80"
              role="img"
              aria-label={`Map of ${profile.displayName}'s position and route`}
            >
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
            {stops.length ? (
              <ol className="divide-y divide-slate-100 border-t border-slate-100" aria-label="Stops in order">
                {stops.map((stop, index) => (
                  <li key={`${stop.deliveryId}-${stop.kind}`}>
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
                            {stop.kind === 'pickup' ? `Pickup · ${stop.title}` : stop.customerName}
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-slate-700 tabular-nums">
                            {formatClockET(now + Math.max(0, stop.arrivalOffsetSeconds - elapsed) * 1000)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{stop.address}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <StatusBadge status={stop.status} />
                          <span className="text-[11px] text-slate-400">
                            {stop.orderId} · {formatDistance(stop.legMeters)} ·{' '}
                            {formatDuration(stop.legSeconds)}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : null}
          </Card>

          <EarningsCard driver={profile} now={now} />

          <Card>
            <CardHeader title="Recent deliveries" description="The latest 50 deliveries of this driver." />
            {deliveries.error && deliveries.data.length === 0 ? (
              <ErrorState error={deliveries.error} onRetry={deliveries.retry} className="m-5" />
            ) : deliveries.loading && deliveries.data.length === 0 ? (
              <PageSpinner label="Loading deliveries" />
            ) : deliveries.data.length === 0 ? (
              <EmptyState icon={PackageIcon} title="No deliveries yet" className="py-10" />
            ) : (
              <DeliveriesTable deliveries={deliveries.data} now={now} />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <VehicleCard driver={profile} isAdmin={isAdmin} />
          <ComplianceCard key={profile.updatedAt ?? 0} driver={profile} isAdmin={isAdmin} now={now} />
          <PayoutAccountCard
            key={profile.payoutAccount?.accountRef ?? 'none'}
            driver={profile}
            isAdmin={isAdmin}
          />
          {isAdmin ? (
            <Card>
              <CardHeader
                title="Signed-in devices"
                description="Sign out a lost phone without suspending the driver."
              />
              <CardBody>
                <SessionsPanel uid={profile.id} name={profile.displayName} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <DriverStatusDialog driver={dialog ? profile : null} action={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
