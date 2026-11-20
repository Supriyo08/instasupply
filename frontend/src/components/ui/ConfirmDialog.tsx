import { describeError } from '@instasupply/api-client';
import { useState, type ReactNode } from 'react';

import { Button } from './Button';
import { Callout } from './Feedback';
import { ErrorIcon } from './icons';
import { Modal } from './Modal';

/**
 * "Are you sure?" for one action. The action's error is shown inside the dialog (a toast would sit
 * under the backdrop; R52), and the dialog closes only when the action succeeded.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<unknown>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (caught) {
      setBusy(false);
      setError(describeError(caught));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
