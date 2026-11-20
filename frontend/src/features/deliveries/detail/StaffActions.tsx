import { FAILURE_REASONS, canTransition, type FailureReasonId } from '@instasupply/shared';
import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea, Toggle } from '@/components/ui/Form';
import {
  CancelIcon,
  EditIcon,
  ErrorIcon,
  FailedIcon,
  MoreIcon,
  RefreshIcon,
  StoreIcon,
  SuccessIcon,
  SuspendIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { MenuItem, Popover } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { call, errorMessage } from '@/lib/api';
import type { DeliveryRecord } from '@/lib/data';

import { awaitingPickup } from '../delivery-format';

type Action = 'cancel' | 'cancel_order' | 'fail' | 'deliver' | 'unassign' | 'reattempt' | 'return';

interface Copy {
  title: string;
  description: string;
  confirm: string;
  success: string;
}

function copyFor(action: Action, delivery: DeliveryRecord): Copy {
  const driver = delivery.driverName;
  switch (action) {
    case 'cancel':
      return {
        title: 'Cancel delivery',
        description: driver
          ? `${driver} is notified and the stop is removed from their route. This cannot be undone.`
          : 'The delivery leaves the unassigned queue. This cannot be undone.',
        confirm: 'Cancel delivery',
        success: 'Delivery cancelled',
      };
    case 'cancel_order':
      return {
        title: 'Cancel the store order',
        description:
          'This delivery carries a customer’s store order, so it is cancelled with the order, on the order page. Cancelling there notifies the customer, puts the items back in the store’s stock, refunds or releases their card and removes the job from the board.',
        confirm: 'Go to the order',
        success: '',
      };
    case 'fail':
      return {
        title: 'Mark as failed',
        description:
          delivery.kind === 'marketplace'
            ? 'Record why the load could not be delivered. The store order shows the failure, and you then re-attempt or return the load to the store.'
            : 'Record why the delivery could not be completed. You can reassign it afterwards to retry.',
        confirm: 'Mark as failed',
        success: 'Marked as failed',
      };
    case 'deliver':
      return {
        title: 'Mark as delivered',
        description:
          'Use this when the site contact confirmed delivery outside the app. It is recorded as a dispatch override, without a photo.',
        confirm: 'Mark as delivered',
        success: 'Marked as delivered',
      };
    case 'unassign':
      return {
        title: 'Unassign driver',
        description:
          delivery.kind === 'marketplace'
            ? `${driver ?? 'The driver'} is notified, their pickup PIN stops working and the job goes back on the board.`
            : `${driver ?? 'The driver'} is notified and the delivery goes back to the unassigned queue.`,
        confirm: 'Unassign',
        success: 'Driver unassigned',
      };
    case 'reattempt':
      return {
        title: 'Re-attempt the delivery',
        description: `The load is still on the truck: ${driver ?? 'the driver'} takes it back to the site. The store order goes back to Out for delivery and the customer is told.`,
        confirm: 'Re-attempt',
        success: 'Delivery re-attempted',
      };
    case 'return':
      return {
        title: 'Return the load to the store',
        description:
          'The store order is cancelled and the load goes back to the store. The customer is refunded the items; whether they pay the delivery and labourer fees follows the failure reason unless you waive them below.',
        confirm: 'Return to store',
        success: 'Returned to the store',
      };
  }
}

/**
 * The page's Actions menu: dispatch overrides, each behind a confirmation that shows its own error
 * (R52). Marketplace deliveries follow MARKETPLACE §2.3: no cancel here (the store order is cancelled
 * on the order page, and the dialog says what that does: ux #2), no status past `accepted` before the
 * store hands over the load, and a failed one is resolved with re-attempt or return to store. The
 * destructive item comes last, after a divider.
 */
export function StaffActions({ delivery, onEdit }: { delivery: DeliveryRecord; onEdit: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<FailureReasonId>('no_one_on_site');
  const [waiveFees, setWaiveFees] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketplace = delivery.kind === 'marketplace' && !!delivery.storeOrderId;
  const requiresPickup = !!delivery.pickup && awaitingPickup(delivery);
  const ctx = { requiresPickup };
  const status = delivery.status;
  const allowed: Record<Action, boolean> = {
    cancel: !marketplace && canTransition(status, 'cancelled', 'staff', ctx),
    cancel_order: marketplace && requiresPickup && canTransition(status, 'cancelled', 'staff', ctx),
    fail: status !== 'failed' && canTransition(status, 'failed', 'staff', ctx),
    deliver: canTransition(status, 'delivered', 'staff', ctx),
    unassign:
      !!delivery.driverId &&
      status !== 'failed' &&
      canTransition(status, 'unassigned', 'staff', ctx) &&
      !(marketplace && !requiresPickup),
    reattempt: marketplace && status === 'failed',
    return: marketplace && status === 'failed',
  };
  const editable = !['delivered', 'cancelled'].includes(status);

  const menu: { action: Action | 'edit'; label: string; icon: IconComponent; danger?: boolean }[] = [
    { action: 'edit', label: 'Edit details', icon: EditIcon },
    { action: 'reattempt', label: 'Re-attempt delivery', icon: RefreshIcon },
    { action: 'return', label: 'Return to store', icon: StoreIcon },
    { action: 'unassign', label: 'Unassign driver', icon: SuspendIcon },
    { action: 'deliver', label: 'Mark as delivered', icon: SuccessIcon },
    { action: 'fail', label: 'Mark as failed', icon: FailedIcon },
    { action: 'cancel_order', label: 'Cancel store order…', icon: CancelIcon, danger: true },
    { action: 'cancel', label: 'Cancel delivery', icon: CancelIcon, danger: true },
  ];
  const items = menu.filter((item) => (item.action === 'edit' ? editable : allowed[item.action]));

  const close = () => {
    if (busy) return;
    setAction(null);
    setNote('');
    setError(null);
    setWaiveFees(false);
  };

  const confirm = async () => {
    if (!action || busy) return;
    if (action === 'cancel_order') {
      setAction(null);
      if (delivery.sourceOrderId) navigate(`/orders/${delivery.sourceOrderId}`);
      return;
    }
    setBusy(true);
    setError(null);
    const text = note.trim() || null;
    try {
      if (action === 'unassign') {
        await call('assignDelivery', { deliveryId: delivery.id, driverId: null, note: text });
      } else if (action === 'reattempt' || action === 'return') {
        await call('resolveFailedDelivery', {
          storeOrderId: delivery.storeOrderId!,
          action: action === 'reattempt' ? 'reattempt' : 'return_to_store',
          ...(action === 'return' && waiveFees ? { refundDeliveryFee: true } : {}),
          note: text,
        });
      } else if (action === 'deliver' && marketplace) {
        await call('completeDelivery', { deliveryId: delivery.id, note: text });
      } else {
        await call('updateDeliveryStatus', {
          deliveryId: delivery.id,
          status: action === 'cancel' ? 'cancelled' : action === 'fail' ? 'failed' : 'delivered',
          failureReason: action === 'fail' ? reason : null,
          note: text,
        });
      }
      toast.success(copyFor(action, delivery).success, delivery.orderId);
      setBusy(false);
      setAction(null);
      setNote('');
      setWaiveFees(false);
    } catch (caught) {
      setBusy(false);
      setError(errorMessage(caught));
    }
  };

  const copy = action ? copyFor(action, delivery) : null;
  const destructive = action === 'cancel' || action === 'fail' || action === 'return';

  if (items.length === 0) return null;

  return (
    <>
      <Popover
        className="w-60 p-1.5"
        trigger={({ toggle, open }) => (
          <Button
            variant="secondary"
            icon={MoreIcon}
            onClick={toggle}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            Actions
          </Button>
        )}
      >
        {(closeMenu) => (
          <div role="menu" aria-label={`Actions for ${delivery.orderId}`}>
            {items.map((item, index) => (
              <Fragment key={item.action}>
                {item.danger && !items[index - 1]?.danger ? <div className="my-1 h-px bg-slate-100" /> : null}
                <MenuItem
                  tone={item.danger ? 'danger' : 'default'}
                  icon={<item.icon size={16} aria-hidden />}
                  onClick={() => {
                    closeMenu();
                    if (item.action === 'edit') onEdit();
                    else setAction(item.action);
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
            <Button variant="secondary" onClick={close} disabled={busy}>
              Back
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void confirm()}
            >
              {copy?.confirm}
            </Button>
          </>
        }
      >
        {action === 'cancel_order' ? null : (
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
            {action === 'return' ? (
              <Toggle
                checked={waiveFees}
                onChange={setWaiveFees}
                label="Waive the delivery and labourer fees"
                description="Refund them even though the site caused the failure."
              />
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
            {error ? (
              <Callout tone="danger" icon={ErrorIcon} title={`Couldn't update ${delivery.orderId}`}>
                {error}
              </Callout>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
