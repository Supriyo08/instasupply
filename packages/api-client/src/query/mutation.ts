import type { ApiClient } from '../client';
import { toApiError, type ApiError } from '../errors';

import type { QueryCacheImpl } from './query-cache';
import type { QueryKey } from './types';

export interface OptimisticCache {
  patch<T>(key: QueryKey, apply: (current: T) => T): void;
}

export interface MutationOptions<V, R> {
  /** Runs before the request. Every patch is undone automatically when the request fails. */
  optimistic?(cache: OptimisticCache, variables: V): void;
  /** Key prefixes to invalidate after success, in addition to what the command or resource function already invalidates. */
  invalidate?(variables: V, result: R): readonly QueryKey[];
  onSuccess?(result: R, variables: V): void;
  onError?(error: ApiError, variables: V): void;
}

export interface MutationState {
  busy: boolean;
  error: ApiError | null;
}

/**
 * The mutation logic behind `useApiMutation` (CLIENTS §1.12), framework-free: optimistic patches,
 * rollback on failure, patches kept until the refetches of the affected keys have settled, and a
 * second `run` while busy returning the first promise.
 */
export class MutationRunner<V, R> {
  private inflight: Promise<R> | null = null;
  private state: MutationState = { busy: false, error: null };

  constructor(
    private readonly client: ApiClient,
    private readonly cache: QueryCacheImpl,
    private readonly onChange: (state: MutationState) => void,
  ) {}

  getState(): MutationState {
    return this.state;
  }

  run(
    mutate: (api: ApiClient, variables: V) => Promise<R>,
    variables: V,
    options: MutationOptions<V, R> | undefined,
  ): Promise<R> {
    if (this.inflight) return this.inflight;
    const rollbacks: (() => void)[] = [];
    const patchedKeys: QueryKey[] = [];
    try {
      options?.optimistic?.(
        {
          patch: <T>(key: QueryKey, apply: (current: T) => T) => {
            rollbacks.push(this.cache.patch<T>(key, apply));
            patchedKeys.push(key);
          },
        },
        variables,
      );
    } catch (error) {
      for (const rollback of rollbacks.reverse()) rollback();
      return Promise.reject(toApiError(error));
    }
    this.set({ busy: true, error: null });
    const promise = (async () => {
      let result: R;
      try {
        result = await mutate(this.client, variables);
      } catch (raw) {
        const error = toApiError(raw);
        for (const rollback of rollbacks.reverse()) rollback();
        this.set({ busy: false, error });
        options?.onError?.(error, variables);
        throw error;
      }
      const prefixes = [...patchedKeys, ...(options?.invalidate?.(variables, result) ?? [])];
      // The patches stay until every refetch of the affected keys has settled, so the value never flashes
      // back to the old one between the write and the refetch.
      if (rollbacks.length > 0) {
        void Promise.all([
          ...prefixes.map((prefix) => this.cache.invalidate(prefix)),
          ...patchedKeys.map((key) => this.cache.whenIdleFor(key)),
        ]).finally(() => {
          for (const rollback of rollbacks) rollback();
        });
      } else {
        for (const prefix of prefixes) void this.cache.invalidate(prefix);
      }
      this.set({ busy: false, error: null });
      options?.onSuccess?.(result, variables);
      return result;
    })().finally(() => {
      this.inflight = null;
    });
    this.inflight = promise;
    return promise;
  }

  reset(): void {
    if (this.state.error !== null || this.state.busy) this.set({ busy: this.inflight !== null, error: null });
  }

  private set(state: MutationState): void {
    this.state = state;
    this.onChange(state);
  }
}
