import { formatDistance, formatDuration, formatEta, toMillis } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback';
import { Toggle } from '@/components/ui/Form';
import { RefreshIcon, RouteIcon, SearchIcon, TruckIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { presenceOf, useNow, useRoute } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

import { DriverList, sortDriverRows } from './DriverList';
import { FleetMap } from './FleetMap';
import { useFleet } from './useFleet';

export default function LiveMapPage() {
  const now = useNow(10_000);
  const toast = useToast();
  const fleet = useFleet();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [planning, setPlanning] = useState(false);
  const route = useRoute(selectedId);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? fleet.rows.filter((row) =>
          `${row.driver.displayName} ${row.driver.vehicle?.plate ?? ''}`.toLowerCase().includes(term),
        )
      : fleet.rows;
    return sortDriverRows(filtered, now);
  }, [fleet.rows, now, search]);

  const online = fleet.rows.filter((row) => presenceOf(row.location, now) === 'online').length;
  const selected = fleet.rows.find((row) => row.driver.id === selectedId) ?? null;
  const elapsed = route.data ? (now - (toMillis(route.data.computedAt) ?? now)) / 1000 : 0;

  const replan = async () => {
    if (!selectedId) return;
    setPlanning(true);
    try {
      const result = await call('optimizeRoute', { driverId: selectedId });
      toast.success(
        'Route re-optimized',
        `${result.stops} stops · ${formatDuration(result.totalSeconds)} · ${formatDistance(result.totalMeters)}`,
      );
    } catch (error) {
      toast.error("Couldn't optimize the route", errorMessage(error));
    } finally {
      setPlanning(false);
    }
  };

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col sm:-mx-6 lg:-mx-8 lg:flex-row">
      <aside className="flex max-h-[45%] flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-80 lg:border-r lg:border-b-0">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-slate-900">Live fleet</h1>
            <span className="text-xs text-slate-500">
              <span className="font-semibold text-emerald-600">{online}</span> of {fleet.rows.length} online
            </span>
          </div>
          <div className="relative">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              aria-label="Search drivers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search drivers or plates"
              className="h-9 w-full rounded-lg border-0 bg-slate-100 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
          </div>
          <Toggle checked={showUnassigned} onChange={setShowUnassigned} label="Show unassigned deliveries" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {fleet.error ? (
            <ErrorState error={fleet.error} className="m-4" />
          ) : fleet.loading && rows.length === 0 ? (
            <div className="p-6">
              <Spinner label="Loading fleet" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={TruckIcon} title="No drivers found" className="py-10" />
          ) : (
            <DriverList rows={rows} now={now} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
      </aside>

      <section className="relative min-h-0 flex-1">
        <FleetMap
          drivers={fleet.drivers}
          locations={fleet.locations}
          deliveries={fleet.openDeliveries}
          now={now}
          selectedDriverId={selectedId}
          route={route.data}
          onSelectDriver={setSelectedId}
          showUnassigned={showUnassigned}
          fitPaddingRight={selectedId ? 360 : 0}
        />

        {selected ? (
          <div className="absolute top-3 right-3 z-[1000] w-[min(22rem,calc(100%-1.5rem))] animate-slide-up rounded-2xl bg-white/95 shadow-pop ring-1 ring-slate-200 backdrop-blur">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <Link
                  to={`/drivers/${selected.driver.id}`}
                  className="truncate text-sm font-semibold text-slate-900 hover:text-brand-700"
                >
                  {selected.driver.displayName}
                </Link>
                <p className="text-xs text-slate-500">
                  {route.data?.stops.length
                    ? `${route.data.stops.length} stops · ${formatDuration(route.data.totalSeconds)} · ${formatDistance(route.data.totalMeters)}`
                    : 'No planned stops'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshIcon}
                loading={planning}
                onClick={() => void replan()}
              >
                Re-plan
              </Button>
            </div>
            {route.data?.stops.length ? (
              <ol className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {route.data.stops.map((stop, index) => (
                  <li key={stop.deliveryId}>
                    <Link
                      to={`/deliveries/${stop.deliveryId}`}
                      className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50"
                    >
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-900">
                            {stop.customerName}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-slate-600 tabular-nums">
                            {formatEta(stop.arrivalOffsetSeconds - elapsed, now)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <StatusBadge status={stop.status} />
                          <span className="truncate text-xs text-slate-500">{stop.orderId}</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
                <RouteIcon size={16} aria-hidden /> Assign deliveries to build a route.
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
