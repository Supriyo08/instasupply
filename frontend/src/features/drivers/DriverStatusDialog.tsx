import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, TextArea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { DriverRecord } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

export type DriverStatusAction = 'approve' | 'suspend' | 'reactivate';

const COPY: Record<
  DriverStatusAction,
  { title: string; description: string; confirm: string; success: string }
> = {
  approve: {
    title: 'Approve driver',
    description: 'They can go online and receive deliveries immediately. They get a notification.',
    confirm: 'Approve',
    success: 'Driver approved',
  },
  suspend: {
    title: 'Suspend driver',
    description:
      'Their account is disabled and they are signed out of every device. Reassign any deliveries they still hold.',
    confirm: 'Suspend',
    success: 'Driver suspended',
  },
  reactivate: {
    title: 'Reactivate driver',
    description: 'Their account is enabled again and they can sign back in.',
    confirm: 'Reactivate',
    success: 'Driver reactivated',
  },
};

export function DriverStatusDialog({
  driver,
  action,
  onClose,
}: {
  driver: DriverRecord | null;
  action: DriverStatusAction | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = action ? COPY[action] : null;

  const confirm = async () => {
    if (!driver || !action) return;
    setBusy(true);
    try {
      await call('setDriverStatus', {
        uid: driver.id,
        status: action === 'suspend' ? 'suspended' : 'active',
        reason: action === 'suspend' ? reason.trim() || null : null,
      });
      toast.success(copy!.success, driver.displayName);
      setReason('');
      onClose();
    } catch (error) {
      toast.error(`Couldn't update ${driver.displayName}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!driver && !!action}
      onClose={onClose}
      size="sm"
      title={copy && driver ? `${copy.title}: ${driver.displayName}` : ''}
      description={copy?.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === 'suspend' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void confirm()}
          >
            {copy?.confirm}
          </Button>
        </>
      }
    >
      {action === 'suspend' ? (
        <Field label="Reason" hint="Kept on their profile for your team.">
          {(id, describedBy) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
            />
          )}
        </Field>
      ) : driver ? (
        <dl className="space-y-1 text-sm text-slate-600">
          <div>
            <dt className="inline font-medium text-slate-800">Email: </dt>
            <dd className="inline">{driver.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-800">Phone: </dt>
            <dd className="inline">{driver.phoneNumber ?? 'Not verified yet'}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-800">Vehicle: </dt>
            <dd className="inline">
              {driver.vehicle
                ? `${driver.vehicle.type} · ${driver.vehicle.plate}${driver.vehicle.model ? ` · ${driver.vehicle.model}` : ''}`
                : '—'}
            </dd>
          </div>
        </dl>
      ) : null}
    </Modal>
  );
}
