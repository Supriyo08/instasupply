import { useCallback, useState, useSyncExternalStore } from 'react';

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

interface DialogState<T> {
  open: boolean;
  data: T | null;
  session: number;
}

/**
 * Open/close state for a dialog about one item. `session` changes each time it opens: use it as the
 * dialog's `key` so its form starts fresh. Closing keeps the same instance mounted, so the native
 * <dialog> closes normally and returns focus to the button that opened it.
 */
export function useDialogState<T>() {
  const [state, setState] = useState<DialogState<T>>({ open: false, data: null, session: 0 });
  const show = useCallback(
    (data: T | null = null) => setState((current) => ({ open: true, data, session: current.session + 1 })),
    [],
  );
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  return { ...state, show, close };
}
