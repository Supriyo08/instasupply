import { formatCurrency, pluralize } from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, TextArea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { DeliveryRecord, OrderRecord } from '@/lib/data';
import { call, errorMessage } from '@/lib/firebase/callables';

/**
 * Staff cancel a shop order by cancelling its delivery; the backend then cancels the order,
 * returns the stock, flags card payments for refund and notifies the shopper.
 */
export function CancelOrderModal({
  order,
  delivery,
  open,
  onClose,
}: {
  order: OrderRecord;
  delivery: DeliveryRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setNote('');
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await call('updateDeliveryStatus', {
        deliveryId: order.deliveryId,
        status: 'cancelled',
        note: note.trim() || null,
      });
      toast.success(`${order.number} cancelled`, 'The shopper has been notified.');
      setNote('');
      onClose();
    } catch (error) {
      toast.error(`Couldn't cancel ${order.number}`, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const consequences = [
    'The shopper is notified that the store cancelled the order.',
    order.itemCount === 1
      ? 'The item goes back into stock.'
      : `All ${pluralize(order.itemCount, 'item')} go back into stock.`,
    order.paymentMethod === 'card' && order.paymentStatus === 'paid'
      ? `The card payment of ${formatCurrency(order.total)} is marked for refund.`
      : order.paymentMethod === 'cod'
        ? 'Nothing to refund: the shopper pays cash on delivery.'
        : null,
    delivery?.driverId
      ? `${delivery.driverName ?? 'The driver'} is notified and the stop is removed from their route.`
      : null,
  ].filter((line): line is string => !!line);

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={`Cancel order · ${order.number}`}
      description="This can't be undone."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Keep order
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            Cancel order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Field label="Note" hint="Optional. Saved on the delivery timeline; the shopper doesn't see it.">
          {(id, describedBy) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={busy}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
