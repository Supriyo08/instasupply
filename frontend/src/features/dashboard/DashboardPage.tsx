import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import {
  formatDateTimeET,
  STORE_ORDER_META,
  toLocal,
  WEEKDAY_NAMES,
  type StoreOrderStatus,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import {
  ClockIcon,
  DollarIcon,
  FailedIcon,
  IssueIcon,
  JobsIcon,
  LiveIcon,
  MapIcon,
  OrdersIcon,
  QuoteIcon,
  StoreIcon,
  SupportIcon,
  TruckIcon,
  UploadIcon,
} from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { ImportCsvModal } from '@/features/deliveries/import/ImportCsvModal';
import { FleetMap } from '@/features/live-map/FleetMap';
import { useFleet } from '@/features/live-map/useFleet';
import { queries } from '@/lib/api';
import { useActivity, useFailedStoreOrders, useOpsDashboard } from '@/lib/data';

import { ActivityFeed } from './ActivityFeed';
import { Amount, KpiTile } from './KpiTile';
import { buildAttentionItems, NeedsAttention } from './NeedsAttention';

const greeting = (minutes: number) =>
  minutes < 12 * 60 ? 'Good morning' : minutes < 17 * 60 ? 'Good afternoon' : 'Good evening';

/** The store-order statuses that are still in play, in board order. */
const OPEN_STORE_STATUSES: StoreOrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

/**
 * Ops dashboard (MARKETPLACE §9 `/`): today's marketplace numbers from `GET /ops/dashboard` (never a
 * count of a capped list, R47 and R48), the "Needs attention" lists, the live fleet and recent activity.
 */
export default function DashboardPage() {
  const now = useServerNow(15_000);
  const { displayName } = useSignedInUser();
  const dashboard = useOpsDashboard();
  const fleet = useFleet();
  const activity = useActivity(25);
  const overdue = usePagedQuery(queries.opsStoreOrders({ acceptOverdue: true, status: ['new'] }));
  const failed = useFailedStoreOrders();
  const offers = useLiveQuery(queries.opsJobOffers());
  const issues = usePagedQuery(queries.opsIssues({ status: ['open', 'in_review'] }));
  const quotes = usePagedQuery(queries.opsQuotes({ status: ['submitted', 'in_review'] }));
  const captures = usePagedQuery(queries.opsOrders({ paymentStatus: 'capture_failed' }));
  const [importOpen, setImportOpen] = useState(false);

  const stats = dashboard.data;
  const kpiLoading = dashboard.loading && !stats;
  const kpiFailed = !!dashboard.error && !stats;

  const attention = useMemo(
    () =>
      buildAttentionItems({
        overdue: overdue.items,
        overdueCount: stats?.acceptOverdue ?? 0,
        failed: failed.items,
        failedCount: stats?.failedDeliveries ?? 0,
        offers: offers.data,
        issues: issues.items,
        quotes: quotes.items,
        captureFailures: captures.items,
        captureFailureCount: stats?.captureFailures ?? 0,
        pendingDrivers: fleet.allDrivers.filter((driver) => driver.status === 'pending'),
        fleet: fleet.rows,
        now,
      }),
    [
      captures.items,
      failed.items,
      fleet.allDrivers,
      fleet.rows,
      issues.items,
      now,
      offers.data,
      overdue.items,
      quotes.items,
      stats,
    ],
  );
  const attentionLoading =
    [overdue, failed, issues, quotes, captures].some((list) => list.loading) || offers.loading;
  const attentionError =
    [overdue, failed, issues, quotes, captures].some((list) => !!list.error) || !!offers.error;

  const local = toLocal(now);
  const firstName = displayName.split(' ')[0];
  const openStoreOrders = OPEN_STORE_STATUSES.reduce(
    (sum, status) => sum + (stats?.storeOrdersByStatus[status] ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title={`${greeting(local.minutes)}, ${firstName}`}
        description={
          <>
            {WEEKDAY_NAMES[local.weekday]} · Toronto time
            {stats ? <> · updated {formatDateTimeET(stats.generatedAt, now)}</> : null}
          </>
        }
        actions={
          <Button variant="secondary" icon={UploadIcon} onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
        }
      />

      {kpiFailed ? (
        <p className="mb-3 text-sm text-rose-600" role="alert">
          Couldn't load today's numbers.{' '}
          <button type="button" className="font-semibold underline" onClick={dashboard.retry}>
            Try again
          </button>
        </p>
      ) : null}

      <section aria-label="Today" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Orders today"
          value={stats?.today.orders ?? 0}
          hint={
            stats ? (
              <>
                GMV <Amount cents={stats.today.gmvCents} />
              </>
            ) : undefined
          }
          icon={OrdersIcon}
          to="/orders"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Open store orders"
          value={openStoreOrders}
          hint={
            stats ? (
              <span className="flex flex-wrap gap-x-2">
                {OPEN_STORE_STATUSES.filter((status) => stats.storeOrdersByStatus[status]).map((status) => (
                  <span key={status}>
                    {stats.storeOrdersByStatus[status]} {STORE_ORDER_META[status].label.toLowerCase()}
                  </span>
                ))}
              </span>
            ) : undefined
          }
          icon={StoreIcon}
          tone="info"
          to="/orders?tab=store-orders"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Overdue acceptance"
          value={stats?.acceptOverdue ?? 0}
          hint={stats?.acceptOverdue ? 'Stores past their reply time' : 'Every store replied in time'}
          icon={ClockIcon}
          tone={stats?.acceptOverdue ? 'danger' : 'neutral'}
          alert={!!stats?.acceptOverdue}
          to="/orders?tab=store-orders"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Job offers"
          value={stats ? stats.jobOffers.open : 0}
          hint={
            stats ? (
              <>
                {stats.jobOffers.scheduled} scheduled
                {stats.jobOffers.unclaimedOver15Min ? (
                  <span className="font-semibold text-amber-700">
                    {' '}
                    · {stats.jobOffers.unclaimedOver15Min} unclaimed &gt; 15 min
                  </span>
                ) : null}
              </>
            ) : undefined
          }
          icon={JobsIcon}
          tone="warning"
          alert={!!stats?.jobOffers.unclaimedOver15Min}
          to="/jobs"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Active deliveries"
          value={stats?.activeDeliveries ?? 0}
          hint={
            stats?.failedDeliveries ? (
              <span className="text-rose-600">{stats.failedDeliveries} failed, waiting for a decision</span>
            ) : (
              'With a driver right now'
            )
          }
          icon={TruckIcon}
          tone="brand"
          to="/deliveries?tab=active"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Live stores"
          value={stats?.liveStores ?? 0}
          hint="Taking orders now"
          icon={StoreIcon}
          tone="success"
          to="/stores"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Quotes waiting"
          value={stats?.quotes.waiting ?? 0}
          hint={
            stats?.quotes.nearRespondBy ? (
              <span className="font-semibold text-amber-700">
                {stats.quotes.nearRespondBy} due within 10 min
              </span>
            ) : (
              '30-minute reply promise'
            )
          }
          icon={QuoteIcon}
          tone="info"
          alert={!!stats?.quotes.nearRespondBy}
          to="/quotes"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Open issues"
          value={stats?.issues.open ?? 0}
          hint={
            stats?.issues.pastSla ? (
              <span className="font-semibold text-rose-600">{stats.issues.pastSla} past SLA</span>
            ) : (
              'All within SLA'
            )
          }
          icon={IssueIcon}
          tone={stats?.issues.pastSla ? 'danger' : 'neutral'}
          alert={!!stats?.issues.pastSla}
          to="/issues"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Unread support"
          value={stats?.unreadSupport ?? 0}
          hint="Customer and store threads"
          icon={SupportIcon}
          tone="info"
          to="/support"
          loading={kpiLoading}
          failed={kpiFailed}
        />
        <KpiTile
          label="Capture failures"
          value={stats?.captureFailures ?? 0}
          hint={stats?.captureFailures ? 'Cards that could not be charged' : 'All cards charged'}
          icon={stats?.captureFailures ? FailedIcon : DollarIcon}
          tone={stats?.captureFailures ? 'danger' : 'neutral'}
          alert={!!stats?.captureFailures}
          to="/orders"
          loading={kpiLoading}
          failed={kpiFailed}
        />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <LiveIcon size={14} className="text-emerald-500" aria-hidden /> Live fleet
              </span>
            }
            description="Drivers, stores with loads to collect and open deliveries, live."
            action={
              <>
                {stats?.pendingDrivers ? (
                  <Link to="/drivers?tab=pending">
                    <Badge tone="warning">{stats.pendingDrivers} drivers to approve</Badge>
                  </Link>
                ) : null}
                <Link
                  to="/live"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  <MapIcon size={14} aria-hidden /> Full map
                </Link>
              </>
            }
          />
          <div className="h-[420px]" role="img" aria-label="Map of drivers and open deliveries">
            <FleetMap
              drivers={fleet.drivers}
              locations={fleet.locations}
              deliveries={fleet.openDeliveries}
              now={now}
              scrollWheelZoom={false}
            />
          </div>
        </Card>
        <NeedsAttention items={attention} loading={attentionLoading} error={attentionError} />
      </div>

      <div className="mt-6">
        <ActivityFeed activity={activity} now={now} />
      </div>

      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
