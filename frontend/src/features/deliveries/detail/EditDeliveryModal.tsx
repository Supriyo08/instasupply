import type { DeliveryPatch } from '@instasupply/api-client';
import { isInServiceArea, validateDeliveryInput } from '@instasupply/shared';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { DeliveryRecord } from '@/lib/data';
import { api, errorMessage } from '@/lib/api';

import { deliveryToDraft, draftToInput, type DeliveryDraft } from '../components/delivery-form';
import { DeliveryFormFields, type DraftErrors } from '../components/DeliveryFormFields';

/**
 * Edits the site contact, drop-off and trip details in place (`PATCH /deliveries/{id}`, the
 * staff-editable keys only), so status and assignment can never be changed from here.
 */
export function EditDeliveryModal({
  delivery,
  open,
  onClose,
}: {
  delivery: DeliveryRecord;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  // The draft the modal opened with: only fields the user changed are sent, so another dispatcher's
  // concurrent correction of a different field is never reverted (verified defect R42).
  const [base] = useState<DeliveryDraft>(() => deliveryToDraft(delivery));
  const [draft, setDraft] = useState<DeliveryDraft>(base);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const patch = useCallback(
    (change: Partial<DeliveryDraft>) => setDraft((current) => ({ ...current, ...change })),
    [],
  );

  const save = async () => {
    const result = validateDeliveryInput(draftToInput(draft));
    if (!result.ok) return setErrors(result.errors);
    if (!result.value.location) return setErrors({ location: 'Place the drop-off pin on the map.' });
    if (!isInServiceArea(result.value.location)) {
      return setErrors({ location: 'The pin is outside the Greater Toronto Area service area.' });
    }
    if (saving) return;
    setErrors({});
    setSaving(true);
    const value = result.value;
    try {
      const changed = (key: keyof DeliveryDraft) => JSON.stringify(draft[key]) !== JSON.stringify(base[key]);
      const patch: DeliveryPatch = {};
      if (changed('customerName') || changed('customerPhone') || changed('customerEmail')) {
        patch.customer = { name: value.customerName, phone: value.customerPhone, email: value.customerEmail };
      }
      if (changed('address')) patch.address = value.address;
      if (changed('location') && value.location) patch.location = value.location;
      if (changed('addressNotes')) patch.addressNotes = value.addressNotes;
      if (changed('notes')) patch.notes = value.notes;
      if (changed('packageCount')) patch.packageCount = value.packageCount;
      if (changed('priority')) patch.priority = value.priority;
      if (changed('requireCode')) patch.requireCode = value.requireCode;
      if (changed('windowStart')) patch.windowStart = value.windowStart;
      if (changed('windowEnd')) patch.windowEnd = value.windowEnd;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      await api.deliveries.update(delivery.id, patch);
      // The server decides whom it notifies; the console does not claim it (verified defects R41, R43).
      toast.success(`${delivery.orderId} updated`);
      onClose();
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="xl"
      dismissOnBackdrop={false}
      title={`Edit ${delivery.orderId}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form ? (
          <Callout tone="warning" icon={WarningIcon}>
            {errors.form}
          </Callout>
        ) : null}
        <DeliveryFormFields draft={draft} errors={errors} onChange={patch} />
      </div>
    </Modal>
  );
}
