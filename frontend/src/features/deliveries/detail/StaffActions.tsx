import { FAILURE_REASONS, canTransition, type FailureReasonId } from '@instasupply/shared';
import { Fragment, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea } from '@/components/ui/Form';
import {
  CancelIcon,
  EditIcon,
  FailedIcon,
  MoreIcon,
  SuccessIcon,
  SuspendIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { MenuItem, Popover } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import type { DeliveryRecord } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

type Action = 'cancel' | 'fail' | 'deliver' | 'unassign';

const COPY: Record<Action, { title: string; description: string; confirm: string; success: string }> = {
  cancel: {
    title: 'Cancel delivery',
    description: 'The driver is notified and the stop is removed from their route. This cannot be undone.',
    confirm: 'Cancel delivery',
    success: 'Delivery cancelled',
  },
  fail: {
    title: 'Mark as failed',
    description: 'Record why the delivery could not be completed. You can reassign it afterwards to retry.',
    confirm: 'Mark as failed',
    success: 'Marked as failed',
  },
  deliver: {
    title: 'Mark as delivered',
    description:
      'Use this when the customer confirmed delivery outside the app. It is recorded as a dispatch override.',
    confirm: 'Mark as delivered',
    success: 'Marked as delivered',
  },
  unassign: {
    title: 'Unassign driver',
    description: 'The delivery goes back to the unassigned queue and the driver is notified.',
    confirm: 'Unassign',
    success: 'Driver unassigned',
  },
};

/** Overflow menu with dispatch overrides, each behind a confirmation dialog. */
export function StaffActions({ delivery, onEdit }: { delivery: DeliveryRecord; onEdit: () => void }) {
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<FailureReasonId>('customer_unavailable');
  const [busy, setBusy] = useState(false);

  const allowed = {
    cancel: canTransition(delivery.status, 'cancelled', 'staff'),
    fail: canTransition(delivery.status, 'failed', 'staff'),
    deliver: canTransition(delivery.status, 'delivered', 'staff'),
    unassign: !!delivery.driverId && canTransition(delivery.status, 'unassigned', 'staff'),
  };
  const editable = !['delivered', 'cancelled'].includes(delivery.status);

  const menu: {
    label: string;
    icon: IconComponent;
    enabled: boolean;
    onSelect: () => void;
    danger?: boolean;
  }[] = [
    { label: 'Edit details', icon: EditIcon, enabled: editable, onSelect: onEdit },
    {
      label: 'Unassign driver',
      icon: SuspendIcon,
      enabled: allowed.unassign,
      onSelect: () => setAction('unassign'),
    },
    {
      label: 'Mark as delivered',
      icon: SuccessIcon,
      enabled: allowed.deliver,
      onSelect: () => setAction('deliver'),
    },
    { label: 'Mark as failed', icon: FailedIcon, enabled: allowed.fail, onSelect: () => setAction('fail') },
    {
      label: 'Cancel delivery',
      icon: CancelIcon,
      enabled: allowed.cancel,
      onSelect: () => setAction('cancel'),
      danger: true,
    },
  ];

  const close = () => {
    setAction(null);
    setNote('');
  };

  const confirm = async () => {
    if (!action) return;
    setBusy(true);
    try {
      if (action === 'unassign') {
        await call('assignDelivery', { deliveryId: delivery.id, driverId: null, note: note.trim() || null });
      } else {
        await call('updateDeliveryStatus', {
          deliveryId: delivery.id,
          status: action === 'cancel' ? 'cancelled' : action === 'fail' ? 'failed' : 'delivered',
          failureReason: action === 'fail' ? reason : null,
          note: note.trim() || null,
        });
      }
      toast.success(COPY[action].success, delivery.orderId);
      close();
    } catch (error) {
      toast.error(`Couldn't update ${delivery.orderId}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = action ? COPY[action] : null;

  return (
    <>
      <Popover
        className="w-56 p-1.5"
        trigger={({ toggle, open }) => (
          <Button variant="secondary" icon={MoreIcon} onClick={toggle} aria-expanded={open}>
            Actions
          </Button>
        )}
      >
        {(closeMenu) => (
          <div>
            {menu.map((item) => (
              <Fragment key={item.label}>
                {item.danger ? <div className="my-1 h-px bg-slate-100" /> : null}
                <MenuItem
                  tone={item.danger ? 'danger' : 'default'}
                  icon={<item.icon size={16} aria-hidden />}
                  disabled={!item.enabled}
                  onClick={() => {
                    closeMenu();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </MenuItem>
              </Fragment>
            ))}
          </div>
        )}
      </Popover>

      <Modal
        open={!!action}
        onClose={close}
        size="sm"
        title={copy ? `${copy.title} · ${delivery.orderId}` : ''}
        description={copy?.description}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Back
            </Button>
            <Button
              variant={action === 'cancel' || action === 'fail' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void confirm()}
            >
              {copy?.confirm}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {action === 'fail' ? (
            <Field label="Reason">
              {(id) => (
                <Select
                  id={id}
                  value={reason}
                  onChange={(event) => setReason(event.target.value as FailureReasonId)}
                >
                  {FAILURE_REASONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Note" hint="Saved on the delivery timeline.">
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={500}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
