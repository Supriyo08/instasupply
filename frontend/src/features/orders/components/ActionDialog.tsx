import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { ErrorIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { describeError } from '@/lib/api';

/**
 * A dialog around one server action with a small form (a reason, a PIN, quantities). The action's
 * error stays inside the dialog (R52), the form is kept until the action succeeds or the user cancels
 * (R38: no backdrop dismiss), and a second click while busy does nothing.
 */
export function ActionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  confirmDisabled,
  onConfirm,
  explainError = describeError,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  confirmDisabled?: boolean;
  /** Resolve to close the dialog; reject to show the error and keep the form. */
  onConfirm: () => Promise<unknown>;
  explainError?: (error: unknown) => string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (caught) {
      setBusy(false);
      setError(explainError(caught));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      size={size}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={confirmDisabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled) void confirm();
        }}
      >
        {children}
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
        {/* Enter in a field submits, like the footer button. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
