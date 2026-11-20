import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { IconButton } from './Button';
import { popDialog, pushDialog } from './dialog-stack';
import { CloseIcon } from './icons';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  /**
   * Whether a click on the backdrop closes the modal. Default true. Form modals with a draft that
   * would be lost pass `false`, so only Escape, the close button and Cancel dismiss them.
   */
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/** True when the point lies outside the dialog's box, i.e. on the backdrop. */
function onBackdrop(dialog: HTMLDialogElement, x: number, y: number): boolean {
  const box = dialog.getBoundingClientRect();
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

/**
 * Accessible modal built on the native <dialog> element: focus is trapped, Escape closes it, and
 * focus returns to the trigger.
 *
 * Backdrop dismissal needs the press AND the release on the backdrop (verified defect R38): a drag
 * that starts inside (panning a map, dragging a pin, selecting text) and ends outside produces a
 * click on the dialog element too, and must not close the modal and wipe a form.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  dismissOnBackdrop = true,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) pushDialog(dialog);
    else popDialog(dialog);
    return () => popDialog(dialog);
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        const dialog = ref.current;
        pressedOnBackdrop.current =
          !!dialog && event.target === dialog && onBackdrop(dialog, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        const dialog = ref.current;
        const pressed = pressedOnBackdrop.current;
        pressedOnBackdrop.current = false;
        if (!dismissOnBackdrop || !dialog || !pressed) return;
        if (event.target === dialog && onBackdrop(dialog, event.clientX, event.clientY)) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-slate-900 shadow-pop open:animate-slide-up',
        SIZES[size],
      )}
      aria-labelledby={titleId}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-slate-900">
                {title}
              </h2>
              {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
            <IconButton icon={CloseIcon} label="Close" size="sm" onClick={onClose} />
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
