import { normalizePhone } from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { ErrorIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage } from '@/lib/api';
import type { DeliveryRecord } from '@/lib/data';

/**
 * Books the labourer who helps unload at the site (MARKETPLACE §9 "Labourer queue"): name and phone,
 * then `unload.status = 'booked'` through `PATCH /deliveries/{id}`. Used on /jobs and on the delivery page.
 */
export function LabourerForm({
  delivery,
  onDone,
  compact = false,
}: {
  delivery: DeliveryRecord;
  onDone?: () => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const unload = delivery.unload;
  const [name, setName] = useState(unload?.labourerName ?? '');
  const [phone, setPhone] = useState(unload?.labourerPhone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!unload) return null;

  const save = async (status: 'booked' | 'needed') => {
    if (busy) return;
    const cleanName = name.trim();
    const cleanPhone = normalizePhone(phone);
    if (status === 'booked') {
      if (!cleanName) return setError('Enter the labourer’s name.');
      if (!cleanPhone) return setError('Enter a phone number the driver can call, for example 416-555-0142.');
    }
    setError(null);
    setBusy(true);
    try {
      await api.deliveries.update(delivery.id, {
        unload:
          status === 'booked'
            ? { status, labourerName: cleanName, labourerPhone: cleanPhone }
            : { status, labourerName: null, labourerPhone: null },
      });
      toast.success(
        status === 'booked'
          ? `Labourer booked for ${delivery.orderId}`
          : `${delivery.orderId} needs a labourer again`,
      );
      onDone?.();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save('booked');
      }}
      aria-label={`Labourer for ${delivery.orderId}`}
    >
      <div className={compact ? 'grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end' : 'space-y-3'}>
        <Field label="Labourer name" required>
          {(id) => (
            <TextInput
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          )}
        </Field>
        <Field label="Labourer phone" required>
          {(id) => (
            <TextInput
              id={id}
              type="tel"
              value={phone}
              placeholder="416-555-0142"
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" loading={busy}>
            {unload.status === 'booked' ? 'Save' : 'Book labourer'}
          </Button>
          {unload.status === 'booked' && !compact ? (
            <Button variant="ghost" disabled={busy} onClick={() => void save('needed')}>
              Cancel booking
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <Callout tone="danger" icon={ErrorIcon}>
          {error}
        </Callout>
      ) : null}
    </form>
  );
}
