import { createApiClient, type ApiClient } from '@instasupply/api-client';
import { createNativePlatform } from '@instasupply/api-client/native';
import { Platform } from 'react-native';

import { appVersion, env } from './env';

const holder = globalThis as { __instasupplyApi?: ApiClient };

/**
 * One client per JavaScript runtime (docs/CLIENTS.md §3.1). The holder keeps it across fast refresh.
 * The background location task imports this module too: it uses `api.session.whenRestored()` and never
 * calls `start()`, so a headless runtime opens no socket.
 */
export const api: ApiClient = (holder.__instasupplyApi ??= createApiClient({
  baseUrl: env.apiUrl,
  app: {
    name: 'driver',
    version: appVersion,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
  },
  ...createNativePlatform(),
  onDebug:
    __DEV__ && process.env.EXPO_PUBLIC_API_DEBUG === 'true'
      ? (event) => console.info('[api]', event)
      : undefined,
}));

export const call = api.call;
export {
  ApiError,
  describeError,
  detailsFor,
  errorCodeOf,
  errorStatusOf,
  isApiError,
  isNetworkError,
  queries,
  topics,
} from '@instasupply/api-client';
