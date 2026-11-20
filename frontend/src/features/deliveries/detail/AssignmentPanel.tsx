import {
  formatClockET,
  formatDistance,
  formatDuration,
  formatPhone,
  formatRelativeTime,
  type RoutePlan,
} from '@instasupply/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { MessageIcon, PhoneIcon } from '@/components/ui/icons';
import type { DeliveryRecord, DriverRecord, LocationRecord, Presence } from '@/lib/data';

import { AssignDialog } from '../components/AssignDialog';
import { awaitingPickup, vehicleClassLabel } from '../delivery-format';

const PRESENCE_TEXT = { online: 'Online', stale: 'No signal', offline: 'Offline' };

/**
 * The page's main dispatch control: who has the job, where their next stop for it is, and Assign or
 * Reassign. A marketplace delivery cannot change drivers once the load is collected (MARKETPLACE §2.3).
 */
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
  const [assigning, setAssigning] = useState(false);
  const closed = delivery.status === 'delivered' || delivery.status === 'cancelled';
  const collected = !!delivery.pickup && !awaitingPickup(delivery);
  const lockedAfterCollection = delivery.kind === 'marketplace' && collected;
  const failedMarketplace = delivery.kind === 'marketplace' && delivery.status === 'failed';
  const canAssign = !closed && !lockedAfterCollection && !failedMarketplace;

  const stops = route?.stops ?? [];
  const stopIndex = stops.findIndex((stop) => stop.deliveryId === delivery.id);
  const stop = stopIndex >= 0 ? stops[stopIndex]! : null;
  const elapsed = route ? (now - route.computedAt) / 1000 : 0;
  const etaSeconds = stop ? Math.max(0, stop.arrivalOffsetSeconds - elapsed) : null;

  return (
    <Card>
      <CardHeader
        title="Driver"
        action={
          canAssign ? (
            <Button size="sm" variant={driver ? 'ghost' : 'primary'} onClick={() => setAssigning(true)}>
              {driver ? 'Reassign' : 'Assign driver'}
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
                {driver.vehicle
                  ? ` · ${vehicleClassLabel(driver.vehicle.capacityClass)} · ${driver.vehicle.plate}`
                  : ''}
              </p>
            </div>
            {driver.phoneNumber ? (
              <a
                href={`tel:${driver.phoneNumber}`}
                className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label={`Call ${driver.displayName} at ${formatPhone(driver.phoneNumber)}`}
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
            {closed
              ? 'No driver.'
              : delivery.offerStatus === 'open'
                ? 'On the job board: any driver with a large enough vehicle can claim it, or assign one now.'
                : delivery.offerStatus === 'held'
                  ? 'The store has not accepted the order yet. You can still assign a driver now.'
                  : 'Not assigned yet.'}
          </p>
        )}

        {lockedAfterCollection && !closed && delivery.status !== 'failed' ? (
          <p className="text-xs text-slate-500">The load is collected, so the driver cannot change now.</p>
        ) : null}

        {stop && !closed ? (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
            <div>
              <p className="text-[11px] text-slate-500 uppercase">Stop</p>
              <p className="text-sm font-semibold text-slate-900">
                {stopIndex + 1} of {stops.length}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase">
                {stop.kind === 'pickup' ? 'At store' : 'ETA'}
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {etaSeconds != null ? formatClockET(now + etaSeconds * 1000) : '—'}
              </p>
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
      </CardBody>
      <AssignDialog
        delivery={assigning ? delivery : null}
        open={assigning}
        onClose={() => setAssigning(false)}
      />
    </Card>
  );
}
