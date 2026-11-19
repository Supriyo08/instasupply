import type { Page } from '../contract';
import type { QueryValue } from '../http';
import { REFETCH, type PagedQueryDescriptor, type QueryDescriptor, type QueryKey } from '../query/types';
import { readAll } from '../rest';
import type { LiveEvent } from '../live/live-client';

export interface DescriptorOptions<T> {
  auth?: 'required' | 'none';
  topics?: readonly string[];
  /** Poll interval in seconds while the socket is down (CLIENTS §4.1 column "Poll"); 0 means none. */
  pollS?: number;
  staleMs?: number;
  minRefetchMs?: number;
  reduce?: (current: T, event: LiveEvent) => T | typeof REFETCH;
  expiresAt?: (data: T) => number | null;
}

function common<T>(key: QueryKey, enabled: boolean, options: DescriptorOptions<T>) {
  return {
    key,
    enabled,
    auth: options.auth ?? 'required',
    topics: enabled ? (options.topics ?? []) : [],
    pollMs: (options.pollS ?? 0) * 1000,
    ...(options.staleMs === undefined ? {} : { staleMs: options.staleMs }),
    ...(options.minRefetchMs === undefined ? {} : { minRefetchMs: options.minRefetchMs }),
    ...(options.reduce ? { reduce: options.reduce } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  } as const;
}

/** One document; `notFound` null when the row may legitimately not exist (404 is null). */
export function docQuery<T>(
  key: QueryKey,
  enabled: boolean,
  path: () => string,
  options: DescriptorOptions<T | null> & { query?: Record<string, QueryValue>; notFoundAsNull?: boolean } = {},
): QueryDescriptor<T | null> {
  return {
    ...common(key, enabled, options),
    empty: null,
    fetch: ({ client, signal }) =>
      client.get<T | null>(path(), {
        signal,
        query: options.query,
        auth: options.auth === 'none' ? 'none' : 'required',
        notFoundAsNull: options.notFoundAsNull ?? true,
      }),
  };
}

/** A non-paged list: `limit=500` unless given, following `nextCursor` up to `maxRows` (CLIENTS §4.1). */
export function listQuery<T>(
  key: QueryKey,
  enabled: boolean,
  path: string,
  query: Record<string, QueryValue>,
  options: DescriptorOptions<T[]> & { limit?: number; maxRows?: number; follow?: boolean } = {},
): QueryDescriptor<T[]> {
  return {
    ...common(key, enabled, options),
    empty: [],
    fetch: async ({ client, signal }) => {
      const auth = options.auth === 'none' ? 'none' : 'required';
      if (options.follow === false) {
        const page = await client.list<T>(path, { query, signal, auth, limit: options.limit ?? 500 });
        return page.items;
      }
      return readAll<T>(client, path, {
        query,
        signal,
        auth,
        limit: options.limit ?? 500,
        maxRows: options.maxRows ?? 2_000,
      });
    },
  };
}

/** A plain GET whose answer is the value itself (stats, balances, dashboards). */
export function valueQuery<T>(
  key: QueryKey,
  enabled: boolean,
  empty: T,
  path: () => string,
  query: () => Record<string, QueryValue>,
  options: DescriptorOptions<T> = {},
): QueryDescriptor<T> {
  return {
    ...common(key, enabled, options),
    empty,
    fetch: ({ client, signal }) =>
      client.get<T>(path(), { query: query(), signal, auth: options.auth === 'none' ? 'none' : 'required' }),
  };
}

/** Cursor pagination for `usePagedQuery`. */
export function pagedQuery<T>(
  key: QueryKey,
  enabled: boolean,
  path: string,
  query: Record<string, QueryValue>,
  options: Omit<DescriptorOptions<T[]>, 'reduce' | 'expiresAt'> & { idOf?: (item: T) => string; limit?: number } = {},
): PagedQueryDescriptor<T> {
  const idOf = options.idOf ?? ((item: T) => (item as { id: string }).id);
  return {
    ...common<T[]>(key, enabled, options),
    idOf,
    fetchPage: ({ client, signal }, cursor): Promise<Page<T>> =>
      client.list<T>(path, {
        query,
        signal,
        cursor,
        limit: options.limit,
        auth: options.auth === 'none' ? 'none' : 'required',
      }),
  };
}

/** Payload topics whose event replaces the whole value (tracking). */
export function replaceWithPayload<T>(_current: T, event: LiveEvent): T | typeof REFETCH {
  return event.data === undefined ? REFETCH : (event.data as T);
}

/** Payload `message` events append by id (chat, support); anything else refetches. */
export function appendMessage<T extends { id: string }>(current: T[], event: LiveEvent): T[] | typeof REFETCH {
  if (event.kind !== 'message' || event.data === undefined) return REFETCH;
  const message = event.data as T;
  const index = current.findIndex((item) => item.id === message.id);
  if (index < 0) return [...current, message];
  const next = current.slice();
  next[index] = message;
  return next;
}

/** Payload `created` notifications are prepended; read flags and deletions refetch. */
export function prependCreated<T extends { id: string }>(current: T[], event: LiveEvent): T[] | typeof REFETCH {
  if (event.kind !== 'created' || event.data === undefined) return REFETCH;
  const item = event.data as T;
  return [item, ...current.filter((existing) => existing.id !== item.id)];
}

/** Payload documents with an id replace or join the list (driver locations). */
export function upsertById<T extends { id: string }>(current: T[], event: LiveEvent): T[] | typeof REFETCH {
  if (event.data === undefined) return REFETCH;
  const item = event.data as T;
  if (event.kind === 'deleted') return current.filter((existing) => existing.id !== item.id);
  const index = current.findIndex((existing) => existing.id === item.id);
  if (index < 0) return [...current, item];
  const next = current.slice();
  next[index] = item;
  return next;
}

/** `ids` and `undefined` arguments: a missing id gives a disabled descriptor with a stable key. */
export function idOrNull(value: string | null | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}
