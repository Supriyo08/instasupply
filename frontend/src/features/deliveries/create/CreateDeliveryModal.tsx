import { validateDeliveryInput } from '@instasupply/shared';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useDriverLocations, useDrivers, useNow, useOpenDeliveries } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

import { DeliveryFormFields, type DraftErrors } from '../components/DeliveryFormFields';
import { draftToInput, EMPTY_DRAFT, type DeliveryDraft } from '../components/delivery-form';
import { DriverPicker } from '../components/DriverPicker';
import { rankDrivers } from '../driver-suggestions';

export function CreateDeliveryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow();
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const openDeliveries = useOpenDeliveries();

  const [draft, setDraft] = useState<DeliveryDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);

  const patch = useCallback(
    (change: Partial<DeliveryDraft>) => setDraft((current) => ({ ...current, ...change })),
    [],
  );

  const suggestions = useMemo(
    () =>
      rankDrivers({
        drivers: drivers.data,
        locations: locations.data,
        openDeliveries: openDeliveries.data,
        target: draft.location,
        now,
      }),
    [draft.location, drivers.data, locations.data, now, openDeliveries.data],
  );

  const close = () => {
    setDraft(EMPTY_DRAFT);
    setErrors({});
    onClose();
  };

  const submit = async (openAfter: boolean) => {
    const result = validateDeliveryInput(draftToInput(draft));
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const response = await call('createDeliveries', { deliveries: [result.value] });
      const failure = response.errors[0];
      if (failure) {
        setErrors({ form: failure.message });
        return;
      }
      const created = response.created[0]!;
      const driver = drivers.data.find((item) => item.id === result.value.driverId);
      toast.show({
        tone: 'success',
        title: `${created.orderId} created`,
        description: driver ? `Assigned to ${driver.displayName}.` : 'Added to the unassigned queue.',
        action: openAfter
          ? undefined
          : { label: 'Open', onClick: () => navigate(`/deliveries/${created.id}`) },
      });
      close();
      if (openAfter) navigate(`/deliveries/${created.id}`);
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      title="New delivery"
      description="Customer, drop-off and package details. You can assign a driver now or later."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="secondary" loading={saving} onClick={() => void submit(true)}>
            Create & open
          </Button>
          <Button loading={saving} onClick={() => void submit(false)}>
            Create delivery
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {errors.form ? (
          <Callout tone="warning" icon={WarningIcon}>
            {errors.form}
          </Callout>
        ) : null}
        <DeliveryFormFields draft={draft} errors={errors} onChange={patch} />

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">Assign a driver now</p>
              <p className="text-xs text-slate-500">
                {draft.location
                  ? 'Ranked by distance to the pin, live status and current load.'
                  : 'Drop the pin to rank drivers by distance.'}
              </p>
            </div>
            {draft.driverId ? (
              <Button size="sm" variant="ghost" onClick={() => patch({ driverId: null })}>
                Leave unassigned
              </Button>
            ) : null}
          </div>
          <DriverPicker
            suggestions={suggestions}
            selectedId={draft.driverId}
            onSelect={(driverId) => patch({ driverId: draft.driverId === driverId ? null : driverId })}
            actionLabel="Select"
            limit={4}
          />
        </section>
      </div>
    </Modal>
  );
}
