/**
 * The one API client of the console (docs/CLIENTS.md §3.1). Screens import `api`, `call`, `queries`
 * and the error helpers from here, never from `@instasupply/api-client` directly, so the wiring
 * (base URL, platform bindings, client name) lives in one file.
 */
import { createApiClient, describeError, type ApiClient } from '@instasupply/api-client';
import { createWebPlatform } from '@instasupply/api-client/web';

import { env } from './env';

const holder = globalThis as { __instasupplyConsoleApi?: ApiClient };

/** One client per page. The holder keeps it across Vite hot reloads in development. */
export const api: ApiClient = (holder.__instasupplyConsoleApi ??= createApiClient({
  baseUrl: env.apiUrl,
  app: { name: 'console', version: __APP_VERSION__, platform: 'web' },
  // localStorage: the session survives a reload and is shared by the console's tabs (CLIENTS §1.4).
  ...createWebPlatform(),
}));

/** Typed command: `POST /api/v1/call/<name>`. */
export const call: ApiClient['call'] = api.call;

/** The name the console's screens already import: a user-facing message for any error. */
export const errorMessage = describeError;

export {
  ApiError,
  describeError,
  detailsFor,
  errorCodeOf,
  isApiError,
  isNetworkError,
  queries,
  topics,
} from '@instasupply/api-client';
export type { WithId } from '@instasupply/api-client';
