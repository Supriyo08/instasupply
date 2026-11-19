import { ApiError, errorFromResponse, toApiError } from './errors';
import type { Clock } from './platform';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;

export type AuthMode = 'required' | 'optional' | 'none';

export interface RequestSpec {
  method: HttpMethod;
  /** Below /api/v1, starting with '/'. Path segments are already encoded by the resource functions. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  auth?: AuthMode;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Chooses the default timeout; uploads use the long one. */
  kind?: 'read' | 'write' | 'upload';
}

/** What the pipeline needs from the token manager and the session core. */
export interface HttpAuth {
  /** A valid access token (refreshing first when it has under 60 s left), or null when signed out. */
  accessToken(): Promise<string | null>;
  /**
   * After `unauthenticated` with `token_expired` (or no reason): refresh now, whatever the local deadline
   * says, unless another request already replaced `staleToken` (then that newer token is returned).
   */
  forceRefresh(staleToken: string): Promise<string>;
  /** Any other auth failure of a request that carried a bearer: the session core decides. */
  onAuthFailure(error: ApiError): void;
}

export interface HttpOptions {
  baseUrl: string;
  fetch: typeof fetch;
  clock: Clock;
  timeouts: { readMs: number; writeMs: number; uploadMs: number };
  xClient: string;
  auth: HttpAuth;
  onDebug?: (event: { type: string; [key: string]: unknown }) => void;
}

/** GET retry delays after a retryable error (CLIENTS §1.4 step 8). */
export const GET_RETRY_DELAYS_MS: readonly number[] = [300, 900];

/** Query-string rules of CLIENTS §1.7: nullish left out, arrays joined by commas, booleans as words. */
export function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.append(key, value.join(','));
    } else {
      params.append(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function sleep(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = clock.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clock.clearTimeout(handle);
      reject(new ApiError({ status: 'cancelled', message: 'The request was cancelled.' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class HttpPipeline {
  constructor(private readonly options: HttpOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<T>(spec: RequestSpec): Promise<T> {
    // Only reads repeat on their own: commands and writes are retried by the user with the same client
    // id, which the server recognises (D17).
    const maxAttempts = spec.method === 'GET' ? GET_RETRY_DELAYS_MS.length + 1 : 1;
    let attempt = 0;
    for (;;) {
      try {
        return await this.withAuth<T>(spec);
      } catch (error) {
        const e = toApiError(error);
        attempt += 1;
        if (!e.retryable || attempt >= maxAttempts || spec.signal?.aborted) throw e;
        const delay = GET_RETRY_DELAYS_MS[attempt - 1] ?? 900;
        this.debug({ type: 'http.retry', method: spec.method, path: spec.path, attempt, delay });
        await sleep(this.options.clock, delay, spec.signal);
      }
    }
  }

  private async withAuth<T>(spec: RequestSpec): Promise<T> {
    const mode = spec.auth ?? 'required';
    let token: string | null = null;
    if (mode !== 'none') {
      token = await this.options.auth.accessToken();
      if (token === null && mode === 'required') {
        throw new ApiError({
          status: 'unauthenticated',
          message: 'Sign in to continue.',
          details: { reason: 'token_invalid' },
          method: spec.method,
          path: spec.path,
          fromServer: false,
        });
      }
    }
    try {
      return await this.send<T>(spec, token);
    } catch (error) {
      const e = toApiError(error);
      if (token === null) throw e;
      const reason = e.authReason;
      if (e.status === 'unauthenticated' && (reason === 'token_expired' || reason === null)) {
        // The access token died early (server restart with a new key, clock trouble): one refresh, one repeat.
        const fresh = await this.options.auth.forceRefresh(token);
        try {
          return await this.send<T>(spec, fresh);
        } catch (second) {
          const e2 = toApiError(second);
          if (isSessionEnding(e2)) this.options.auth.onAuthFailure(e2);
          throw e2;
        }
      }
      if (isSessionEnding(e)) this.options.auth.onAuthFailure(e);
      throw e;
    }
  }

  private async send<T>(spec: RequestSpec, token: string | null): Promise<T> {
    const { baseUrl, clock, timeouts } = this.options;
    const url = `${baseUrl}/api/v1${spec.path}${buildQueryString(spec.query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': this.options.xClient };
    const hasBody = spec.body !== undefined;
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const timeoutMs =
      spec.timeoutMs ??
      (spec.kind === 'upload' ? timeouts.uploadMs : spec.method === 'GET' ? timeouts.readMs : timeouts.writeMs);
    const controller = new AbortController();
    let timedOut = false;
    const timer = clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    if (spec.signal?.aborted) controller.abort();
    spec.signal?.addEventListener('abort', onCallerAbort, { once: true });

    const base = { method: spec.method, path: spec.path };
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method: spec.method,
        headers,
        body: hasBody ? JSON.stringify(spec.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      clock.clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onCallerAbort);
      if (timedOut) {
        throw new ApiError({ ...base, status: 'deadline-exceeded', message: 'The request timed out.', cause: error });
      }
      if (spec.signal?.aborted) {
        throw new ApiError({ ...base, status: 'cancelled', message: 'The request was cancelled.', cause: error });
      }
      throw new ApiError({ ...base, status: 'unavailable', message: 'No answer from the server.', cause: error });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new ApiError({
        ...base,
        status: timedOut ? 'deadline-exceeded' : spec.signal?.aborted ? 'cancelled' : 'unavailable',
        message: 'The answer was interrupted.',
        cause: error,
      });
    } finally {
      clock.clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onCallerAbort);
    }

    const requestId = response.headers.get('x-request-id');
    let body: unknown = undefined;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
        if (response.ok) {
          throw new ApiError({
            ...base,
            status: 'internal',
            message: 'The server sent an answer that is not JSON.',
            httpStatus: response.status,
            requestId,
            fromServer: false,
          });
        }
      }
    }
    if (!response.ok) {
      const error = errorFromResponse({ httpStatus: response.status, body, requestId, ...base });
      this.debug({ type: 'http.error', ...base, status: error.status, code: error.code, requestId });
      throw error;
    }
    this.debug({ type: 'http.ok', ...base, httpStatus: response.status });
    return (response.status === 204 ? undefined : body) as T;
  }

  private debug(event: { type: string; [key: string]: unknown }): void {
    this.options.onDebug?.(event);
  }
}

/** Errors after which the session cannot continue (PLATFORM §6.4 table). */
export function isSessionEnding(error: ApiError): boolean {
  if (error.status === 'permission-denied') return error.authReason === 'account_suspended';
  if (error.status !== 'unauthenticated') return false;
  return error.authReason !== 'credentials';
}
