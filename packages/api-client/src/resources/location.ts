import type { LocationAck, LocationReport } from '../contract';

import type { ResourceContext } from './context';

export const locationPaths = { report: '/me/location' } as const;

export function createLocation(ctx: ResourceContext) {
  return {
    /** `POST /me/location` (CLIENTS §5.2). A 10 s timeout: the publisher backs off and keeps its queue. */
    publish: (report: LocationReport, options?: { timeoutMs?: number }) =>
      ctx.rest.post<LocationAck>(locationPaths.report, report, { timeoutMs: options?.timeoutMs ?? 10_000 }),
  };
}
