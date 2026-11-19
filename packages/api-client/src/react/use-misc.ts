import { useCallback, useSyncExternalStore } from 'react';

import type { PublicConfig } from '../contract';
import type { ApiError } from '../errors';
import type { LiveState } from '../live/live-client';
import { queries } from '../queries';

import { useApi } from './ApiProvider';
import { useApiQuery } from './use-query';

/** Null until /config was loaded once on this device (it is cached, so that is the very first start only). */
export function useConfig(): PublicConfig | null {
  const { config } = useApi();
  return useSyncExternalStore(
    (listener) => config.subscribe(listener),
    () => config.get(),
    () => config.get(),
  );
}

export function useLiveStatus(): { state: LiveState; online: boolean } {
  const { live } = useApi();
  const state = useSyncExternalStore(
    (listener) => live.onState(listener),
    () => live.getState(),
    () => live.getState(),
  );
  return { state, online: state !== 'offline' };
}

/** A short-lived URL for a private file. Null path: nothing is loaded. Refetched a minute before it expires. */
export function useFileUrl(path: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: ApiError | null;
  retry: () => void;
} {
  const result = useApiQuery(queries.fileUrl(path));
  const retry = useCallback(() => result.retry(), [result]);
  return { url: result.data?.url ?? null, loading: result.loading, error: result.error, retry };
}
