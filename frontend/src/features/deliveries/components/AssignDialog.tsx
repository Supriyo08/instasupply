import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useDriverLocations, useDrivers, useNow, useOpenDeliveries, type DeliveryRecord } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

import { rankDrivers } from '../driver-suggestions';
import { DriverPicker } from './DriverPicker';

/** Assign or reassign a delivery to the best available driver. */
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

  const suggestions = useMemo(
    () =>
      delivery
        ? rankDrivers({
            drivers: drivers.data,
            locations: locations.data,
            openDeliveries: openDeliveries.data,
            target: delivery.location,
            declinedBy: delivery.declinedBy,
            now,
          }).filter((suggestion) => suggestion.driver.id !== delivery.driverId)
        : [],
    [delivery, drivers.data, locations.data, now, openDeliveries.data],
  );

  const assign = async (driverId: string) => {
    if (!delivery) return;
    setBusyId(driverId);
    try {
      await call('assignDelivery', { deliveryId: delivery.id, driverId, note: note.trim() || null });
      const driver = drivers.data.find((item) => item.id === driverId);
      toast.success(
        `${delivery.orderId} assigned`,
        driver ? `${driver.displayName} has been notified.` : undefined,
      );
      setNote('');
      onClose();
    } catch (error) {
      toast.error("Couldn't assign the delivery", errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        delivery?.driverId ? `Reassign ${delivery.orderId}` : `Assign ${delivery?.orderId ?? 'delivery'}`
      }
      description={delivery ? `${delivery.customer.name} · ${delivery.address}` : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-4">
        <DriverPicker
          suggestions={suggestions}
          onSelect={(id) => void assign(id)}
          busyId={busyId}
          limit={8}
        />
        <Field label="Note for the timeline" hint="Optional, e.g. why this driver was chosen.">
          {(id) => (
            <TextInput
              id={id}
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
