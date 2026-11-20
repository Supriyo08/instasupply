/**
 * Calling the API the way a client does: REST under /api/v1 and commands at POST /api/v1/call/{name}, with
 * an optional bearer token. Assertions on the error envelope of docs/PLATFORM.md §4.2.
 */
import assert from 'node:assert/strict';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import type { TestContext } from './database';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Answer<T = unknown> {
  status: number;
  body: T;
  headers: LightMyRequestResponse['headers'];
}

export interface ErrorEnvelope {
  status: string;
  code: string | null;
  message: string;
  details: Record<string, unknown>;
}

export interface ErrorBody {
  error: ErrorEnvelope;
}

/** The context shape these helpers need, so they also work with a context that only has `app`. */
export type HasApp = Pick<TestContext, 'app'>;

export interface RequestOptions {
  token?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export async function request<T = unknown>(
  ctx: HasApp,
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<Answer<T>> {
  const inject: InjectOptions = {
    method,
    url: path.startsWith('/api/') ? path : `/api/v1${path}`,
    headers: {
      ...(options.headers ?? {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.query ? { query: options.query } : {}),
    ...(body === undefined ? {} : { payload: body as InjectOptions['payload'] }),
  };
  const response = await ctx.app.inject(inject);
  const text = response.body;
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Media and other non-JSON answers stay text.
      parsed = text;
    }
  }
  return { status: response.statusCode, body: parsed as T, headers: response.headers };
}

export const get = <T = unknown>(ctx: HasApp, path: string, options?: RequestOptions) =>
  request<T>(ctx, 'GET', path, undefined, options);
export const post = <T = unknown>(ctx: HasApp, path: string, body: unknown, options?: RequestOptions) =>
  request<T>(ctx, 'POST', path, body ?? {}, options);
export const put = <T = unknown>(ctx: HasApp, path: string, body: unknown, options?: RequestOptions) =>
  request<T>(ctx, 'PUT', path, body ?? {}, options);
export const patch = <T = unknown>(ctx: HasApp, path: string, body: unknown, options?: RequestOptions) =>
  request<T>(ctx, 'PATCH', path, body ?? {}, options);
export const del = <T = unknown>(ctx: HasApp, path: string, options?: RequestOptions) =>
  request<T>(ctx, 'DELETE', path, undefined, options);

/** POST /api/v1/call/{name} (§5.2). */
export const command = <T = unknown>(ctx: HasApp, name: string, body: unknown, token?: string | null) =>
  post<T>(ctx, `/call/${name}`, body ?? {}, { token });

/**
 * Asserts an error answer and returns its envelope. `status` is the HTTP status (409) or the API status
 * ('failed-precondition'); `code` is the domain code ('OUT_OF_STOCK') when one is expected.
 */
export async function expectError(
  answer: Answer<unknown> | Promise<Answer<unknown>>,
  status: number | string,
  code?: string,
): Promise<ErrorEnvelope> {
  const { status: http, body } = await answer;
  const envelope = (body as Partial<ErrorBody> | null)?.error;
  const shown = JSON.stringify(body);
  assert.ok(envelope, `expected an error envelope, got ${http} ${shown}`);
  if (typeof status === 'number') assert.equal(http, status, `HTTP status of ${shown}`);
  else assert.equal(envelope.status, status, `API status of ${http} ${shown}`);
  if (code !== undefined) assert.equal(envelope.code, code, `error code of ${http} ${shown}`);
  return envelope;
}

/** Asserts a success status (200 unless given) and returns the body. */
export async function expectOk<T>(answer: Answer<T> | Promise<Answer<T>>, status = 200): Promise<T> {
  const resolved = await answer;
  assert.equal(
    resolved.status,
    status,
    `expected ${status}, got ${resolved.status} ${JSON.stringify(resolved.body)}`,
  );
  return resolved.body;
}
