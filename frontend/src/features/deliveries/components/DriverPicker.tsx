import { formatDistance, pluralize } from '@instasupply/shared';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { TruckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import type { DriverSuggestion } from '../driver-suggestions';

const PRESENCE_LABEL = { online: 'Online', stale: 'No recent signal', offline: 'Offline' };

/** Ranked list of drivers with one action per row. */
export function DriverPicker({
  suggestions,
  selectedId,
  onSelect,
  actionLabel = 'Assign',
  busyId,
  limit = 6,
}: {
  suggestions: DriverSuggestion[];
  selectedId?: string | null;
  onSelect: (driverId: string) => void;
  actionLabel?: string;
  busyId?: string | null;
  limit?: number;
}) {
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon={TruckIcon}
        title="No approved drivers yet"
        description="Approve drivers on the Drivers page to start assigning work."
        className="py-6"
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {suggestions.slice(0, limit).map((suggestion, index) => {
        const { driver } = suggestion;
        const selected = driver.id === selectedId;
        return (
          <li
            key={driver.id}
            className={cn('flex items-center gap-3 py-2.5', selected && 'rounded-lg bg-brand-50/60 px-2')}
          >
            <Avatar name={driver.displayName} presence={suggestion.presence} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">
                {driver.displayName}
                {index === 0 && !suggestion.declined && suggestion.presence === 'online' ? (
                  <Badge tone="success">Best match</Badge>
                ) : null}
                {suggestion.declined ? <Badge tone="danger">Declined before</Badge> : null}
              </p>
              <p className="truncate text-xs text-slate-500">
                {PRESENCE_LABEL[suggestion.presence]}
                {suggestion.distanceMeters != null
                  ? ` · ${formatDistance(suggestion.distanceMeters)} away`
                  : ''}
                {` · ${pluralize(suggestion.activeCount, 'active stop')}`}
              </p>
            </div>
            <Button
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              loading={busyId === driver.id}
              onClick={() => onSelect(driver.id)}
            >
              {selected ? 'Selected' : actionLabel}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
