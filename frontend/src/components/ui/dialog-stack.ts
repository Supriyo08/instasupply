/**
 * The open modal dialogs, innermost last. A modal `<dialog>` lives in the browser's top layer and
 * makes the rest of the page inert, so the toast outlet is portalled into the innermost one;
 * otherwise an error toast shown while a dialog is open renders under the backdrop and cannot be
 * read or dismissed (verified defect R52).
 */
import { useSyncExternalStore } from 'react';

let stack: readonly HTMLDialogElement[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function pushDialog(dialog: HTMLDialogElement): void {
  if (stack.includes(dialog)) return;
  stack = [...stack, dialog];
  emit();
}

export function popDialog(dialog: HTMLDialogElement): void {
  if (!stack.includes(dialog)) return;
  stack = stack.filter((item) => item !== dialog);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The innermost open modal dialog, or null. */
export function useTopDialog(): HTMLDialogElement | null {
  return useSyncExternalStore(
    subscribe,
    () => stack[stack.length - 1] ?? null,
    () => null,
  );
}
