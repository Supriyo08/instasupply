import type { Page } from './contract';
import { toApiError } from './errors';
import type { AuthMode, HttpPipeline, QueryValue } from './http';

export type { Page, WithId } from './contract';
export type { QueryValue } from './http';

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 'required' (default): send the bearer and fail with `unauthenticated` when signed out. 'optional': send it when there is one. 'none': never send it. */
  auth?: AuthMode;
  /** GET only: turn `not-found` into `null` instead of throwing. */
  notFoundAsNull?: boolean;
}

export interface Rest {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  /** GET that returns `{ items, nextCursor }`. `limit` and `cursor` go into the query string. */
  list<T>(
    path: string,
    options?: RequestOptions & { limit?: number; cursor?: string | null },
  ): Promise<Page<T>>;
  post<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = void>(path: string, options?: RequestOptions): Promise<T>;
}

export function createRest(http: HttpPipeline): Rest {
  const common = (options: RequestOptions | undefined) => ({
    query: options?.query,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    auth: options?.auth,
  });
  return {
    async get<T>(path: string, options?: RequestOptions): Promise<T> {
      try {
        return await http.request<T>({ method: 'GET', path, ...common(options) });
      } catch (error) {
        const e = toApiError(error);
        if (options?.notFoundAsNull && e.status === 'not-found') return null as T;
        throw e;
      }
    },
    list<T>(
      path: string,
      options?: RequestOptions & { limit?: number; cursor?: string | null },
    ): Promise<Page<T>> {
      const query = { ...options?.query, limit: options?.limit, cursor: options?.cursor ?? undefined };
      return http.request<Page<T>>({ method: 'GET', path, ...common(options), query });
    },
    post<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return http.request<T>({ method: 'POST', path, body, ...common(options) });
    },
    put<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return http.request<T>({ method: 'PUT', path, body, ...common(options) });
    },
    patch<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return http.request<T>({ method: 'PATCH', path, body, ...common(options) });
    },
    delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
      return http.request<T>({ method: 'DELETE', path, ...common(options) });
    },
  };
}

/** Non-paged lists read everything (CLIENTS §4.1): follow `nextCursor` up to `maxRows`, return the items. */
export async function readAll<T>(
  rest: Rest,
  path: string,
  options: RequestOptions & { limit?: number; maxRows?: number } = {},
): Promise<T[]> {
  const { maxRows = 2_000, limit = 500, ...request } = options;
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<T> = await rest.list<T>(path, { ...request, limit, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null && items.length < maxRows);
  return items.slice(0, maxRows);
}
