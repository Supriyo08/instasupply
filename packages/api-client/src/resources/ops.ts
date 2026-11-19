import type { StoreSuggestion } from '@instasupply/shared';

import type { WithId } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

export type { JobState, OpsDashboard, OpsStoreRow, OutboxEvent, OutboxMessage } from '../contract';

/** Staff-only views computed by the server (PLATFORM §5.3.10), and store suggestions (§5.3.8). */
export const opsPaths = {
  dashboard: '/ops/dashboard',
  stores: '/ops/stores',
  jobs: '/ops/jobs',
  devOutbox: '/dev-outbox',
  outboxEvents: '/ops/outbox-events',
  outboxEventRetry: (id: number) => `/ops/outbox-events/${seg(String(id))}/retry`,
  suggestions: '/store-suggestions',
  suggestion: (id: string) => `/store-suggestions/${seg(id)}`,
} as const;

export function createSuggestions(ctx: ResourceContext) {
  return {
    setStatus: (id: string, status: StoreSuggestion['status']) =>
      writeThen(ctx, [['suggestions']], () =>
        ctx.rest.patch<WithId<StoreSuggestion>>(opsPaths.suggestion(id), { status }),
      ),
  };
}
