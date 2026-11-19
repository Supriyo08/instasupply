import { useSyncExternalStore } from 'react';

import type { SessionSnapshot } from '../auth/session';

import { useApi } from './ApiProvider';

/** The session snapshot; re-renders when it changes. */
export function useSessionCore(): SessionSnapshot {
  const { session } = useApi();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
}
