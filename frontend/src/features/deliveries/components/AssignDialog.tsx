import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextInput, Toggle } from '@/components/ui/Form';
import { ErrorIcon, WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { call, errorCodeOf, errorMessage } from '@/lib/api';
import { useDriverLocations, useDrivers, useNow, useOpenDeliveries, type DeliveryRecord } from '@/lib/data';

import { awaitingPickup, nextStopOf, vehicleClassLabel } from '../delivery-format';
import { rankDrivers } from '../driver-suggestions';
import { DriverPicker } from './DriverPicker';

/**
 * Assign or reassign a delivery (also a job offer from /jobs) to a driver in any city. The list shows
 * drivers whose vehicle can carry the job; "Show smaller vehicles" lists the rest, and the server's
 * `VEHICLE_TOO_SMALL` answer turns into an explicit "Assign anyway" (`force`). Errors stay inside the
 * dialog (R52).
 */
export function AssignDialog({
  delivery,
  open,
  onClose,
}: {
  delivery: DeliveryRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const now = useNow();
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const openDeliveries = useOpenDeliveries();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooSmall, setTooSmall] = useState<string | null>(null);

  const suggestions = useMemo(
    () =>
      delivery
        ? rankDrivers({
            drivers: drivers.data,
            locations: locations.data,
            openDeliveries: openDeliveries.data,
            target: nextStopOf(delivery),
            vehicleClass: delivery.vehicleClass,
            declinedBy: delivery.declinedBy,
            now,
          }).filter((suggestion) => suggestion.driver.id !== delivery.driverId)
        : [],
    [delivery, drivers.data, locations.data, now, openDeliveries.data],
  );
  const visible = showAll ? suggestions : suggestions.filter((suggestion) => suggestion.fits);
  const hiddenCount = suggestions.length - visible.length;

  const close = () => {
    if (busyId) return;
    setNote('');
    setError(null);
    setTooSmall(null);
    setShowAll(false);
    onClose();
  };

  const assign = async (driverId: string, force = false) => {
    if (!delivery || busyId) return;
    setBusyId(driverId);
    setError(null);
    try {
      await call('assignDelivery', {
        deliveryId: delivery.id,
        driverId,
        note: note.trim() || null,
        ...(force ? { force: true } : {}),
      });
      const driver = drivers.data.find((item) => item.id === driverId);
      toast.success(
        `${delivery.orderId} assigned`,
        driver ? `${driver.displayName} has the job.` : undefined,
      );
      setBusyId(null);
      close();
    } catch (caught) {
      setBusyId(null);
      if (errorCodeOf(caught) === 'VEHICLE_TOO_SMALL' && !force) {
        setTooSmall(driverId);
        return;
      }
      setError(errorMessage(caught));
    }
  };

  const smallDriver = tooSmall ? drivers.data.find((item) => item.id === tooSmall) : null;
  const needs = delivery?.vehicleClass ? vehicleClassLabel(delivery.vehicleClass) : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        delivery?.driverId ? `Reassign ${delivery.orderId}` : `Assign ${delivery?.orderId ?? 'delivery'}`
      }
      description={
        delivery
          ? delivery.pickup && awaitingPickup(delivery)
            ? `${delivery.pickup.storeName} → ${delivery.address}`
            : `${delivery.customer.name} · ${delivery.address}`
          : undefined
      }
      footer={
        <Button variant="secondary" onClick={close} disabled={!!busyId}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-4">
        {needs ? (
          <p className="text-sm text-slate-600">
            This load needs a <span className="font-semibold text-slate-900">{needs}</span> or larger. Drivers
            are ranked by distance to{' '}
            {delivery?.pickup && awaitingPickup(delivery) ? 'the store' : 'the site'}, live status and current
            jobs.
          </p>
        ) : null}
        {error ? (
          <Callout tone="danger" icon={ErrorIcon} title="Couldn't assign the delivery">
            {error}
          </Callout>
        ) : null}
        {tooSmall && smallDriver ? (
          <Callout
            tone="warning"
            icon={WarningIcon}
            title={`${smallDriver.displayName}'s vehicle is too small`}
          >
            <p>
              The approved vehicle is a {vehicleClassLabel(smallDriver.vehicle?.capacityClass)} and this load
              needs a {needs ?? 'larger vehicle'}. Assign anyway only if you confirmed the load fits.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="danger"
                loading={busyId === tooSmall}
                onClick={() => void assign(tooSmall, true)}
              >
                Assign anyway
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setTooSmall(null)}>
                Choose someone else
              </Button>
            </div>
          </Callout>
        ) : null}
        <DriverPicker
          suggestions={visible}
          onSelect={(id) => void assign(id)}
          busyId={busyId}
          disabled={!!busyId}
          limit={8}
          emptyTitle={suggestions.length ? 'No driver with a large enough vehicle' : undefined}
          emptyDescription={
            suggestions.length ? 'Show smaller vehicles to assign one anyway, with a warning.' : undefined
          }
        />
        {needs && (hiddenCount > 0 || showAll) ? (
          <Toggle
            checked={showAll}
            onChange={setShowAll}
            label={`Show smaller vehicles${hiddenCount ? ` (${hiddenCount})` : ''}`}
            description="Assigning one asks you to confirm the load fits."
          />
        ) : null}
        <Field label="Note for the timeline" hint="Optional, for example why this driver was chosen.">
          {(id, describedBy) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
