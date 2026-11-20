import { formatRelativeTime, type AccountStatus } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { TextInput } from '@/components/ui/Form';
import { SearchIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { useAuth } from '@/features/auth/AuthProvider';
import { SceneEmpty } from '@/features/deliveries/components/SceneArt';
import { cityName, vehicleClassLabel } from '@/features/deliveries/delivery-format';
import {
  groupActiveByDriver,
  indexById,
  presenceOf,
  useClosedToday,
  useDriverLocations,
  useDrivers,
  useNow,
  useOpenDeliveries,
  type DriverRecord,
} from '@/lib/data';

import { DriverStatusDialog, type DriverStatusAction } from './DriverStatusDialog';

type Tab = 'all' | AccountStatus | 'review';

const ACCOUNT_TONE = { active: 'success', pending: 'warning', suspended: 'danger' } as const;
const ACCOUNT_LABEL = { active: 'Approved', pending: 'Pending approval', suspended: 'Suspended' };
const PRESENCE_TONE = { online: 'success', stale: 'warning', offline: 'neutral' } as const;
const PRESENCE_LABEL = { online: 'Online', stale: 'No signal', offline: 'Offline' };
const TABS: Tab[] = ['all', 'active', 'pending', 'review', 'suspended'];

export default function DriversPage() {
  const now = useNow();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'all';
  const [search, setSearch] = useState('');
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const open = useOpenDeliveries();
  const closed = useClosedToday();
  const [dialog, setDialog] = useState<{ driver: DriverRecord; action: DriverStatusAction } | null>(null);

  const locationById = useMemo(() => indexById(locations.data), [locations.data]);
  const activeByDriver = useMemo(() => groupActiveByDriver(open.data), [open.data]);
  const deliveredToday = useMemo(() => {
    const counts = new Map<string, number>();
    for (const delivery of closed.data) {
      if (delivery.status === 'delivered' && delivery.driverId) {
        counts.set(delivery.driverId, (counts.get(delivery.driverId) ?? 0) + 1);
      }
    }
    return counts;
  }, [closed.data]);

  const counts: Record<Tab, number> = {
    all: drivers.data.length,
    active: drivers.data.filter((driver) => driver.status === 'active').length,
    pending: drivers.data.filter((driver) => driver.status === 'pending').length,
    review: drivers.data.filter((driver) => driver.vehicleReviewRequired).length,
    suspended: drivers.data.filter((driver) => driver.status === 'suspended').length,
  };
  const term = search.trim().toLowerCase();
  const visible = drivers.data
    .filter((driver) =>
      tab === 'all' ? true : tab === 'review' ? !!driver.vehicleReviewRequired : driver.status === tab,
    )
    .filter((driver) =>
      term
        ? `${driver.displayName} ${driver.email ?? ''} ${driver.phoneNumber ?? ''} ${driver.vehicle?.plate ?? ''} ${cityName(driver.cityId)}`
            .toLowerCase()
            .includes(term)
        : true,
    )
    .sort(
      (a, b) =>
        (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) ||
        a.displayName.localeCompare(b.displayName),
    );

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Approve sign-ups, review vehicles, see who's on shift and manage access."
      />
      <Card>
        <div className="px-5 pt-2">
          <Tabs
            ariaLabel="Driver status"
            value={tab}
            onChange={(value) => setParams(value === 'all' ? {} : { tab: value }, { replace: true })}
            items={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'active', label: 'Approved', count: counts.active },
              { value: 'pending', label: 'Pending approval', count: counts.pending },
              { value: 'review', label: 'Vehicle review', count: counts.review },
              { value: 'suspended', label: 'Suspended', count: counts.suspended },
            ]}
          />
        </div>
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="relative max-w-md">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <TextInput
              aria-label="Search drivers"
              className="pl-9"
              placeholder="Name, email, phone, plate or city"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {drivers.error && drivers.data.length === 0 ? (
          <ErrorState error={drivers.error} onRetry={drivers.retry} className="m-5" />
        ) : drivers.loading && drivers.data.length === 0 ? (
          <PageSpinner label="Loading drivers" />
        ) : visible.length === 0 ? (
          <SceneEmpty
            artKey="scene-welcome"
            title={term ? 'No drivers match your search' : 'No drivers here'}
            description={
              term
                ? 'Try another name or plate.'
                : 'Drivers appear after they sign up in the InstaSupply Driver app.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">Drivers</caption>
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Driver
                  </th>
                  <th scope="col" className="hidden px-3 py-3 font-medium md:table-cell">
                    City
                  </th>
                  <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
                    Vehicle
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Account
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Live
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-medium xl:table-cell">
                    Active jobs
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-medium xl:table-cell">
                    Delivered today
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((driver) => {
                  const location = locationById.get(driver.id) ?? null;
                  const presence = driver.status === 'active' ? presenceOf(location, now) : 'offline';
                  const vehicle = driver.vehicle ?? driver.vehicleDraft ?? null;
                  return (
                    <tr key={driver.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link to={`/drivers/${driver.id}`} className="flex items-center gap-3">
                          <Avatar
                            name={driver.displayName}
                            presence={driver.status === 'active' ? presence : undefined}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900 hover:text-brand-700">
                              {driver.displayName}
                            </span>
                            <span className="block truncate text-xs text-slate-500">
                              {driver.phoneNumber ?? driver.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 md:table-cell">
                        {cityName(driver.cityId)}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                        {vehicle ? (
                          <>
                            <span className="block">
                              {vehicleClassLabel(vehicle.capacityClass)} · {vehicle.make} {vehicle.model}
                            </span>
                            <span className="flex items-center gap-2 font-mono text-xs text-slate-400">
                              {vehicle.plate}
                              {driver.vehicleReviewRequired ? (
                                <Badge tone="warning">Review</Badge>
                              ) : !driver.vehicle ? (
                                <Badge tone="neutral">Draft</Badge>
                              ) : null}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={ACCOUNT_TONE[driver.status]}>{ACCOUNT_LABEL[driver.status]}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        {driver.status === 'active' ? (
                          <span className="flex flex-col gap-0.5">
                            <Badge tone={PRESENCE_TONE[presence]} dot>
                              {PRESENCE_LABEL[presence]}
                            </Badge>
                            {location ? (
                              <span className="text-[11px] text-slate-400">
                                {formatRelativeTime(location.updatedAt, now)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3 text-right text-slate-700 tabular-nums xl:table-cell">
                        {activeByDriver.get(driver.id)?.length ?? 0}
                      </td>
                      <td className="hidden px-3 py-3 text-right text-slate-700 tabular-nums xl:table-cell">
                        {deliveredToday.get(driver.id) ?? 0}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {isAdmin && driver.status === 'pending' ? (
                          <Button size="sm" onClick={() => setDialog({ driver, action: 'approve' })}>
                            Review & approve
                          </Button>
                        ) : isAdmin && driver.status === 'suspended' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDialog({ driver, action: 'reactivate' })}
                          >
                            Reactivate
                          </Button>
                        ) : (
                          <Link
                            to={`/drivers/${driver.id}`}
                            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                            aria-label={`View ${driver.displayName}`}
                          >
                            View
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DriverStatusDialog
        driver={dialog?.driver ?? null}
        action={dialog?.action ?? null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
