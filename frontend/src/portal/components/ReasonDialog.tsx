import type { StoreRejectReason } from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea } from '@/components/ui/Form';
import { ErrorIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';

import { REJECT_REASONS } from './order-format';

/**
 * Reject (from New) or cancel (from Accepted, Preparing or Ready) with a reason (MARKETPLACE §2.1).
 * The error stays inside the dialog; it closes only once the server agreed.
 */
export function ReasonDialog({
  open,
  onClose,
  mode,
  orderNumber,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'reject' | 'cancel';
  orderNumber: string;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: Exclude<StoreRejectReason, 'no_response'>, note: string | null) => void;
}) {
  const [reason, setReason] = useState<Exclude<StoreRejectReason, 'no_response'> | ''>('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const needsNote = reason === 'other';

  const submit = () => {
    if (!reason || (needsNote && !note.trim())) {
      setMissing(true);
      return;
    }
    onConfirm(reason, note.trim() || null);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnBackdrop={false}
      size="sm"
      title={mode === 'reject' ? `Reject ${orderNumber}?` : `Cancel ${orderNumber}?`}
      description={
        mode === 'reject'
          ? "The customer won't be charged for your items and the stock is released. Tell them why."
          : 'The goods stay at your store, the stock is released and the customer is not charged for them. A driver already on the way is told.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep the order
          </Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            {mode === 'reject' ? 'Reject order' : 'Cancel order'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Reason" required error={missing && !reason ? 'Choose a reason.' : null}>
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={reason}
              onChange={(event) => setReason(event.target.value as Exclude<StoreRejectReason, 'no_response'>)}
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {REJECT_REASONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Note for InstaSupply and the customer"
          required={needsNote}
          hint="Optional unless the reason is Other. For example: “Next 2×10 delivery from the mill is Monday.”"
          error={missing && needsNote && !note.trim() ? 'Add a short note.' : null}
        >
          {(id, describedBy) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
      </form>
    </Modal>
  );
}
