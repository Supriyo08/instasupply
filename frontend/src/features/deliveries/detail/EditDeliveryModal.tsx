import { COLLECTIONS, validateDeliveryInput } from '@instasupply/shared';
import { Timestamp, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import type { DeliveryRecord } from '@/lib/data';
import { db } from '@/lib/firebase/app';
import { errorMessage } from '@/lib/firebase/callables';

import { deliveryToDraft, draftToInput, type DeliveryDraft } from '../components/delivery-form';
import { DeliveryFormFields, type DraftErrors } from '../components/DeliveryFormFields';

/**
 * Edits customer and drop-off details in place. Security rules only allow these fields, so
 * status and assignment can never be changed from here.
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
  const { user } = useSignedInUser();
  const toast = useToast();
  const [draft, setDraft] = useState<DeliveryDraft>(() => deliveryToDraft(delivery));
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
    setErrors({});
    setSaving(true);
    const value = result.value;
    try {
      await updateDoc(doc(db, COLLECTIONS.deliveries, delivery.id), {
        customer: { name: value.customerName, phone: value.customerPhone, email: value.customerEmail },
        address: value.address,
        location: value.location,
        addressNotes: value.addressNotes,
        notes: value.notes,
        packageCount: value.packageCount,
        priority: value.priority,
        codAmount: value.codAmount,
        requireCode: value.requireCode,
        windowStart: value.windowStart ? Timestamp.fromMillis(value.windowStart) : null,
        windowEnd: value.windowEnd ? Timestamp.fromMillis(value.windowEnd) : null,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      toast.success(
        `${delivery.orderId} updated`,
        delivery.driverId ? 'The driver has been notified.' : undefined,
      );
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
      onClose={onClose}
      size="xl"
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
