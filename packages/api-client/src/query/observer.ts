import type { ApiError } from '../errors';

import { hashKey, keepsPreviousData, type QueryCacheImpl } from './query-cache';
import type { QueryDescriptor, QueryObservation, QueryResult } from './types';

/**
 * One hook's view of the cache across key changes. It keeps the previous key's data on screen with
 * `loading: true` while a list switches keys (`keepPreviousData`), and returns the same result object
 * until something changes, as `useSyncExternalStore` requires. Framework-free so it is testable alone.
 */
export class QueryObserver<T> {
  private current: { stamp: string; observation: QueryObservation<T> } | null = null;
  private lastSettled: { stamp: string; data: T } | null = null;
  private last: QueryResult<T> | null = null;

  constructor(private readonly cache: QueryCacheImpl) {}

  static stampOf(query: QueryDescriptor<unknown>): string {
    return `${query.enabled === false ? 'off' : 'on'}:${hashKey(query.key)}`;
  }

  /** Starts observing `query` (stops the previous key). Returns the stop function. */
  observe(query: QueryDescriptor<T>, live: boolean, onChange: () => void): () => void {
    const stamp = QueryObserver.stampOf(query as QueryDescriptor<unknown>);
    this.current?.observation.unsubscribe();
    const observation = this.cache.observe(query, { live }, onChange);
    this.current = { stamp, observation };
    return () => {
      if (this.current?.observation === observation) this.current = null;
      observation.unsubscribe();
    };
  }

  getResult(query: QueryDescriptor<T>): QueryResult<T> {
    const stamp = QueryObserver.stampOf(query as QueryDescriptor<unknown>);
    const base =
      this.current && this.current.stamp === stamp ? this.current.observation.getResult() : this.cache.peek(query);
    let result = base;
    if (!base.loading && base.error === null && query.enabled !== false) {
      this.lastSettled = { stamp, data: base.data };
    } else if (
      base.loading &&
      this.lastSettled &&
      this.lastSettled.stamp !== stamp &&
      keepsPreviousData(query as QueryDescriptor<unknown>)
    ) {
      result = { ...base, data: this.lastSettled.data };
    }
    if (this.last && sameResult(this.last, result)) return this.last;
    this.last = result;
    return result;
  }
}

function sameResult<T>(a: QueryResult<T>, b: QueryResult<T>): boolean {
  return (
    a.data === b.data &&
    a.loading === b.loading &&
    (a.error as ApiError | null) === b.error &&
    a.refreshing === b.refreshing &&
    a.updatedAt === b.updatedAt &&
    a.retry === b.retry
  );
}
