import { useCallback, useMemo, useState } from 'react';

import type { ApiError } from '../errors';
import { PagedLoader, pagedEntryDescriptor, type PagedState } from '../query/paged';
import type { PagedQueryDescriptor } from '../query/types';

import { internalCache, useApi } from './ApiProvider';
import { useApiQuery, useLiveQuery } from './use-query';

export interface PagedResult<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: ApiError | null;
  retry: () => void;
  refreshing: boolean;
}

/**
 * Cursor pagination. `live` (default true) subscribes to the descriptor's topics. Events, polls and
 * resyncs refetch only the first page and merge it (CLIENTS §1.11).
 */
export function usePagedQuery<T>(
  query: PagedQueryDescriptor<T>,
  options?: { enabled?: boolean; live?: boolean },
): PagedResult<T> {
  const client = useApi();
  const cache = internalCache(client);
  const descriptor = useMemo(() => pagedEntryDescriptor(query), [query]);
  const live = options?.live !== false;
  // Both hooks are always called (rules of hooks); the unused one is disabled.
  const liveResult = useLiveQuery<PagedState<T>>(descriptor, { enabled: live && options?.enabled !== false });
  const plainResult = useApiQuery<PagedState<T>>(descriptor, { enabled: !live && options?.enabled !== false });
  const result = live ? liveResult : plainResult;
  const [, setTick] = useState(0);
  const loader = useMemo(
    () =>
      new PagedLoader<T>(
        cache,
        () => ({ client, signal: new AbortController().signal }),
        () => setTick((tick) => tick + 1),
      ),
    [cache, client],
  );
  const loadMore = useCallback(() => {
    void loader.loadMore(query);
  }, [loader, query]);
  return {
    items: result.data.items,
    loading: result.loading,
    loadingMore: loader.loadingMore,
    hasMore: result.data.nextCursor !== null,
    loadMore,
    error: result.error ?? loader.error,
    retry: result.retry,
    refreshing: result.refreshing,
  };
}
