import { encodeSegment } from '../http';
import type { QueryKey } from '../query/types';
import type { Rest } from '../rest';

/** What every resource namespace needs: REST, the cache to invalidate, the install id. */
export interface ResourceContext {
  rest: Rest;
  invalidate(prefix: QueryKey): Promise<void>;
  installationId(): Promise<string>;
}

/** Path segment: ids are always encoded, so a stray `/` or `?` can never change the route (CLIENTS §1.7). */
export const seg = encodeSegment;

/** Runs a write, then marks its key families stale (CLIENTS §1.12, source 3). */
export async function writeThen<T>(
  ctx: ResourceContext,
  prefixes: readonly QueryKey[],
  write: () => Promise<T>,
): Promise<T> {
  const result = await write();
  for (const prefix of prefixes) void ctx.invalidate(prefix);
  return result;
}
