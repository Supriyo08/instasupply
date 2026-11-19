import { useCallback, useMemo, useRef, useState } from 'react';

import type { ApiClient } from '../client';
import type { ApiError } from '../errors';
import { MutationRunner, type MutationOptions, type MutationState } from '../query/mutation';

import { internalCache, useApi } from './ApiProvider';

export type { MutationOptions, OptimisticCache } from '../query/mutation';

export interface Mutation<V, R> {
  /** Rejects with ApiError, so `try / catch` plus `describeError` keeps working. A second call while busy returns the first promise. */
  run(variables: V): Promise<R>;
  busy: boolean;
  error: ApiError | null;
  reset(): void;
}

export function useApiMutation<V = void, R = void>(
  mutate: (api: ApiClient, variables: V) => Promise<R>,
  options?: MutationOptions<V, R>,
): Mutation<V, R> {
  const client = useApi();
  const cache = internalCache(client);
  const [state, setState] = useState<MutationState>({ busy: false, error: null });
  const runner = useMemo(() => new MutationRunner<V, R>(client, cache, setState), [client, cache]);
  // The latest closures are used at call time, so inline arrow functions do not recreate the runner.
  const latest = useRef({ mutate, options });
  latest.current = { mutate, options };
  const run = useCallback(
    (variables: V) => runner.run(latest.current.mutate, variables, latest.current.options),
    [runner],
  );
  const reset = useCallback(() => runner.reset(), [runner]);
  return { run, busy: state.busy, error: state.error, reset };
}
