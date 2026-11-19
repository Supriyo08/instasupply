import { formatRelativeTime, pluralize, STATUS_META } from '@instasupply/shared';

import { Avatar } from '@/components/ui/Avatar';
import { BatteryIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { presenceOf, type DeliveryRecord, type DriverRecord, type LocationRecord } from '@/lib/data';

export interface DriverRow {
  driver: DriverRecord;
  location: LocationRecord | null;
  active: DeliveryRecord[];
}

const PRESENCE_ORDER = { online: 0, stale: 1, offline: 2 };

export function sortDriverRows(rows: DriverRow[], now: number): DriverRow[] {
  return [...rows].sort(
    (a, b) =>
      PRESENCE_ORDER[presenceOf(a.location, now)] - PRESENCE_ORDER[presenceOf(b.location, now)] ||
      b.active.length - a.active.length ||
      a.driver.displayName.localeCompare(b.driver.displayName),
  );
}

export function DriverList({
  rows,
  now,
  selectedId,
  onSelect,
}: {
  rows: DriverRow[];
  now: number;
  selectedId: string | null;
  onSelect: (driverId: string | null) => void;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(({ driver, location, active }) => {
        const presence = presenceOf(location, now);
        const current = active.find(
          (delivery) => delivery.status === 'in_transit' || delivery.status === 'arrived',
        );
        const selected = driver.id === selectedId;
        return (
          <li key={driver.id}>
            <button
              type="button"
              onClick={() => onSelect(selected ? null : driver.id)}
              aria-pressed={selected}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                selected ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
            >
              <Avatar name={driver.displayName} presence={presence} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{driver.displayName}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {location ? formatRelativeTime(location.updatedAt, now) : 'never'}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {current
                    ? `${STATUS_META[current.status].label} → ${current.orderId} · ${current.customer.name}`
                    : active.length
                      ? `${pluralize(active.length, 'stop')} planned`
                      : presence === 'offline'
                        ? 'Offline'
                        : 'Available'}
                </span>
                {location?.battery != null && presence !== 'offline' ? (
                  <span
                    className={cn(
                      'mt-1 inline-flex items-center gap-1 text-[11px]',
                      location.battery < 0.2 ? 'text-rose-600' : 'text-slate-400',
                    )}
                  >
                    <BatteryIcon size={12} aria-hidden /> {Math.round(location.battery * 100)}%
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
