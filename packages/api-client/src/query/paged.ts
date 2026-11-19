import type { Page } from '../contract';
import { toApiError, type ApiError } from '../errors';

import type { QueryCache, QueryContext, QueryDescriptor, PagedQueryDescriptor } from './types';

/** What a paged list keeps in the cache: every loaded page as one array plus the cursor after it. */
export interface PagedState<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Merges a fresh first page into the loaded list (CLIENTS §1.11): when the fresh page's last item is in
 * the loaded array, everything loaded after it stays behind the fresh page (fresh copies win); when it
 * is not, the list resets to the fresh page.
 */
export function mergeFirstPage<T>(
  current: PagedState<T> | undefined,
  fresh: Page<T>,
  idOf: (item: T) => string,
): PagedState<T> {
  if (!current || current.items.length <= fresh.items.length) {
    return { items: fresh.items, nextCursor: fresh.nextCursor };
  }
  const last = fresh.items[fresh.items.length - 1];
  if (last === undefined) return { items: [], nextCursor: fresh.nextCursor };
  const anchor = idOf(last);
  const index = current.items.findIndex((item) => idOf(item) === anchor);
  if (index < 0) return { items: fresh.items, nextCursor: fresh.nextCursor };
  const tail = current.items.slice(index + 1);
  if (tail.length === 0) return { items: fresh.items, nextCursor: fresh.nextCursor };
  const freshIds = new Set(fresh.items.map(idOf));
  return {
    items: [...fresh.items, ...tail.filter((item) => !freshIds.has(idOf(item)))],
    nextCursor: current.nextCursor,
  };
}

/** Appends a further page, de-duplicated by id (an item that moved up is kept where it already is). */
export function appendPage<T>(current: PagedState<T>, page: Page<T>, idOf: (item: T) => string): PagedState<T> {
  const seen = new Set(current.items.map(idOf));
  return {
    items: [...current.items, ...page.items.filter((item) => !seen.has(idOf(item)))],
    nextCursor: page.nextCursor,
  };
}

/** The cache entry behind a paged list: its fetch reloads the first page and merges it. */
export function pagedEntryDescriptor<T>(query: PagedQueryDescriptor<T>): QueryDescriptor<PagedState<T>> {
  const { fetchPage, idOf, ...rest } = query;
  return {
    ...rest,
    empty: { items: [], nextCursor: null },
    keepPreviousData: true,
    async fetch(context: QueryContext) {
      const fresh = await fetchPage(context, null);
      const current = context.client.cache.getData<PagedState<T>>(query.key);
      return mergeFirstPage(current, fresh, idOf);
    },
  };
}

/** Loads the page after the stored cursor and writes the longer list into the cache. */
export class PagedLoader<T> {
  private inflight: Promise<void> | null = null;
  private lastError: ApiError | null = null;

  constructor(
    private readonly cache: QueryCache,
    private readonly makeContext: () => QueryContext,
    private readonly onChange: () => void,
  ) {}

  get loadingMore(): boolean {
    return this.inflight !== null;
  }

  get error(): ApiError | null {
    return this.lastError;
  }

  loadMore(query: PagedQueryDescriptor<T>): Promise<void> {
    if (this.inflight) return this.inflight;
    const state = this.cache.getData<PagedState<T>>(query.key);
    if (!state || state.nextCursor === null) return Promise.resolve();
    const cursor = state.nextCursor;
    this.lastError = null;
    this.inflight = (async () => {
      try {
        const page = await query.fetchPage(this.makeContext(), cursor);
        this.cache.setData<PagedState<T>>(query.key, (current) =>
          // A first-page refresh may have replaced the list meanwhile; append only to the list it continues.
          current && current.nextCursor === cursor ? appendPage(current, page, query.idOf) : current,
        );
      } catch (error) {
        this.lastError = toApiError(error);
      } finally {
        this.inflight = null;
        this.onChange();
      }
    })();
    this.onChange();
    return this.inflight;
  }
}
