import { formatDistance, pluralize } from '@instasupply/shared';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { TruckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import { cityName, vehicleClassLabel } from '../delivery-format';
import type { DriverSuggestion } from '../driver-suggestions';

const PRESENCE_LABEL = { online: 'Online', stale: 'No recent signal', offline: 'Offline' };

/** Ranked list of drivers with one action per row. */
export function DriverPicker({
  suggestions,
  selectedId,
  onSelect,
  actionLabel = 'Assign',
  busyId,
  disabled,
  limit = 6,
  emptyTitle = 'No approved drivers yet',
  emptyDescription = 'Approve drivers on the Drivers page to start assigning work.',
}: {
  suggestions: DriverSuggestion[];
  selectedId?: string | null;
  onSelect: (driverId: string) => void;
  actionLabel?: string;
  busyId?: string | null;
  /** Every row's button is disabled (another assignment is running). */
  disabled?: boolean;
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (suggestions.length === 0) {
    return <EmptyState icon={TruckIcon} title={emptyTitle} description={emptyDescription} className="py-6" />;
  }

  return (
    <ul className="divide-y divide-slate-100" aria-label="Drivers, best match first">
      {suggestions.slice(0, limit).map((suggestion, index) => {
        const { driver } = suggestion;
        const selected = driver.id === selectedId;
        const vehicle = driver.vehicle;
        return (
          <li
            key={driver.id}
            className={cn('flex items-center gap-3 py-2.5', selected && 'rounded-lg bg-brand-50/60 px-2')}
          >
            <Avatar name={driver.displayName} presence={suggestion.presence} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                <span className="truncate">{driver.displayName}</span>
                {index === 0 &&
                !suggestion.declined &&
                suggestion.fits &&
                suggestion.presence === 'online' ? (
                  <Badge tone="success">Best match</Badge>
                ) : null}
                {!suggestion.fits ? <Badge tone="warning">Vehicle too small</Badge> : null}
                {suggestion.declined ? <Badge tone="danger">Declined before</Badge> : null}
              </p>
              <p className="truncate text-xs text-slate-500">
                {PRESENCE_LABEL[suggestion.presence]}
                {suggestion.distanceMeters != null
                  ? ` · ${formatDistance(suggestion.distanceMeters)} away`
                  : ''}
                {` · ${pluralize(suggestion.activeCount, 'active job')}`}
                {vehicle ? ` · ${vehicleClassLabel(vehicle.capacityClass)} · ${vehicle.plate}` : ''}
                {driver.cityId ? ` · ${cityName(driver.cityId)}` : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              loading={busyId === driver.id}
              disabled={disabled && busyId !== driver.id}
              onClick={() => onSelect(driver.id)}
              aria-label={`${selected ? 'Selected' : actionLabel}: ${driver.displayName}`}
            >
              {selected ? 'Selected' : actionLabel}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
