import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { QueryObserver } from '../query/observer';
import type { QueryDescriptor, QueryResult } from '../query/types';

import { internalCache, useApi } from './ApiProvider';

function withEnabled<T>(query: QueryDescriptor<T>, enabled: boolean | undefined): QueryDescriptor<T> {
  return enabled === false && query.enabled !== false ? { ...query, enabled: false } : query;
}

/** Shared by both hooks: one observer per hook instance, re-subscribed when the key changes. */
function useObservedQuery<T>(query: QueryDescriptor<T>, live: boolean): QueryResult<T> {
  const client = useApi();
  const cache = internalCache(client);
  const observer = useMemo(() => new QueryObserver<T>(cache), [cache]);
  // The newest descriptor is read at subscribe and snapshot time; only the key decides re-subscribing.
  const latest = useRef(query);
  latest.current = query;
  const stamp = QueryObserver.stampOf(query as QueryDescriptor<unknown>);
  // `stamp` changes exactly when the key or `enabled` changes: that, and only that, re-subscribes.
  const subscribe = useCallback(
    (onChange: () => void) => observer.observe(latest.current, live, onChange, stamp),
    [observer, stamp, live],
  );
  const getSnapshot = useCallback(() => observer.getResult(latest.current), [observer]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Fetch and cache. Refetches when stale on mount and foreground, and when invalidated. Ignores `topics` and `pollMs`. */
export function useApiQuery<T>(query: QueryDescriptor<T>, options?: { enabled?: boolean }): QueryResult<T> {
  return useObservedQuery(withEnabled(query, options?.enabled), false);
}

/** The same, plus the query's live topics and the polling fallback. */
export function useLiveQuery<T>(query: QueryDescriptor<T>, options?: { enabled?: boolean }): QueryResult<T> {
  return useObservedQuery(withEnabled(query, options?.enabled), true);
}
