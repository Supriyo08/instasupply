import { createApiClient } from '@instasupply/api-client';
import { createNativePlatform } from '@instasupply/api-client/native';
import { Platform } from 'react-native';

import { appVersion, env } from './env';

type Client = ReturnType<typeof createApiClient>;

const holder = globalThis as { __instasupplyApi?: Client };

function platformName(): 'android' | 'ios' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'web') return 'web';
  return 'android';
}

/** One client per JavaScript runtime (docs/CLIENTS.md §3.1). The holder keeps it across fast refresh. */
export const api: Client = (holder.__instasupplyApi ??= createApiClient({
  baseUrl: env.apiUrl,
  app: { name: 'customer', version: appVersion, platform: platformName() },
  ...createNativePlatform(),
}));

export const call = api.call;
export {
  ApiError,
  describeError,
  detailsFor,
  errorCodeOf,
  errorStatusOf,
  isNetworkError,
  queries,
  topics,
} from '@instasupply/api-client';
