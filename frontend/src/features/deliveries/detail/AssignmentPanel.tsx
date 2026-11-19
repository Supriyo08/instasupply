import {
  formatDistance,
  formatDuration,
  formatEta,
  formatRelativeTime,
  isTerminalStatus,
  toMillis,
  type RoutePlan,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { MessageIcon, PhoneIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import {
  useDriverLocations,
  useDrivers,
  useOpenDeliveries,
  type DeliveryRecord,
  type DriverRecord,
  type LocationRecord,
  type Presence,
} from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

import { DriverPicker } from '../components/DriverPicker';
import { rankDrivers } from '../driver-suggestions';

const PRESENCE_TEXT = { online: 'Online', stale: 'No signal', offline: 'Offline' };

export function AssignmentPanel({
  delivery,
  driver,
  location,
  presence,
  route,
  now,
}: {
  delivery: DeliveryRecord;
  driver: DriverRecord | null;
  location: LocationRecord | null;
  presence: Presence;
  route: RoutePlan | null;
  now: number;
}) {
  const toast = useToast();
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const openDeliveries = useOpenDeliveries();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const terminal = isTerminalStatus(delivery.status) && delivery.status !== 'failed';

  const suggestions = useMemo(
    () =>
      rankDrivers({
        drivers: drivers.data,
        locations: locations.data,
        openDeliveries: openDeliveries.data,
        target: delivery.location,
        declinedBy: delivery.declinedBy,
        now,
      }).filter((suggestion) => suggestion.driver.id !== delivery.driverId),
    [
      delivery.declinedBy,
      delivery.driverId,
      delivery.location,
      drivers.data,
      locations.data,
      now,
      openDeliveries.data,
    ],
  );

  const assign = async (driverId: string) => {
    setBusyId(driverId);
    try {
      await call('assignDelivery', { deliveryId: delivery.id, driverId });
      toast.success(`${delivery.orderId} assigned`, 'The driver has been notified.');
      setShowPicker(false);
    } catch (error) {
      toast.error("Couldn't assign the delivery", errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const stopIndex = route?.stops.findIndex((stop) => stop.deliveryId === delivery.id) ?? -1;
  const stop = stopIndex >= 0 ? route!.stops[stopIndex]! : null;
  const elapsed = route ? (now - (toMillis(route.computedAt) ?? now)) / 1000 : 0;
  const etaSeconds = stop ? Math.max(0, stop.arrivalOffsetSeconds - elapsed) : null;

  return (
    <Card>
      <CardHeader
        title="Driver"
        action={
          driver && !terminal ? (
            <Button size="sm" variant="ghost" onClick={() => setShowPicker((value) => !value)}>
              {showPicker ? 'Close' : 'Reassign'}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {driver ? (
          <div className="flex items-center gap-3">
            <Avatar name={driver.displayName} presence={presence} size="md" />
            <div className="min-w-0 flex-1">
              <Link
                to={`/drivers/${driver.id}`}
                className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-700"
              >
                {driver.displayName}
              </Link>
              <p className="truncate text-xs text-slate-500">
                {PRESENCE_TEXT[presence]}
                {location ? ` · seen ${formatRelativeTime(location.updatedAt, now)}` : ''}
                {driver.vehicle ? ` · ${driver.vehicle.plate}` : ''}
              </p>
            </div>
            {driver.phoneNumber ? (
              <a
                href={`tel:${driver.phoneNumber}`}
                className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label={`Call ${driver.displayName}`}
              >
                <PhoneIcon size={16} aria-hidden />
              </a>
            ) : null}
            <Link
              to={`/messages/${driver.id}`}
              className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={`Message ${driver.displayName}`}
            >
              <MessageIcon size={16} aria-hidden />
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {terminal ? 'No driver.' : 'Not assigned yet. Pick the best available driver below.'}
          </p>
        )}

        {stop && !terminal ? (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
            <div>
              <p className="text-[11px] text-slate-500 uppercase">Stop</p>
              <p className="text-sm font-semibold text-slate-900">
                {stopIndex + 1} of {route!.stops.length}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase">ETA</p>
              <p className="text-sm font-semibold text-slate-900">{formatEta(etaSeconds, now)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase">Leg</p>
              <p className="text-sm font-semibold text-slate-900">{formatDistance(stop.legMeters)}</p>
            </div>
            <p className="col-span-3 text-[11px] text-slate-400">
              {formatDuration(etaSeconds)} away · planned {formatRelativeTime(route!.computedAt, now)} (
              {route!.provider})
            </p>
          </div>
        ) : null}

        {!terminal && (!driver || showPicker) ? (
          <DriverPicker
            suggestions={suggestions}
            onSelect={(id) => void assign(id)}
            busyId={busyId}
            limit={5}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}
