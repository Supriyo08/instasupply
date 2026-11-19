import { createContext, useContext, useEffect, type ReactElement, type ReactNode } from 'react';

import type { ApiClient } from '../client';
import { QueryCacheImpl } from '../query/query-cache';

const ApiContext = createContext<ApiClient | null>(null);

/** Calls `client.start()` once. Place it above the app's own session provider. */
export function ApiProvider(props: { client: ApiClient; children: ReactNode }): ReactElement {
  const { client } = props;
  useEffect(() => {
    // Idempotent, so StrictMode's double effect is harmless. No dispose on unmount: the client lives as
    // long as the JavaScript runtime (one client per runtime, CLIENTS §1 rule 2).
    client.start();
  }, [client]);
  return <ApiContext.Provider value={client}>{props.children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>.');
  return client;
}

/** The hooks need the cache's internal `peek`, which is not part of the public `QueryCache` contract. */
export function internalCache(client: ApiClient): QueryCacheImpl {
  if (!(client.cache instanceof QueryCacheImpl)) throw new Error('This ApiClient was not made by createApiClient.');
  return client.cache;
}
