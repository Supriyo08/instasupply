import { isNetworkError } from '@instasupply/api-client';
import { useLiveQuery } from '@instasupply/api-client/react';

import { queries } from '@/lib/api';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{12,64}$/;

/**
 * The public tracking row of `/track/:token`, live without signing in. `notFound` is true only when the
 * server answered that the token does not exist; a slow or failed connection is `connecting` or `error`,
 * never "link not found" (verified defect R55).
 */
export function useTracking(token: string | undefined) {
  const valid = !!token && TOKEN_FORMAT.test(token);
  const state = useLiveQuery(queries.tracking(valid ? token : null));
  const connecting =
    state.loading || (state.error !== null && isNetworkError(state.error) && state.data === null);
  return {
    ...state,
    invalidToken: !valid,
    connecting,
    notFound: valid && !state.loading && state.error === null && state.data === null,
  };
}
