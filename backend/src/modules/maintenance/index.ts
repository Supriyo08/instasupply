/** Platform jobs: purgeExpiredRows and the runJobNow command (docs/PLATFORM.md §2.1, §9.5). */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerJob } from '../../platform/scheduler/registry';
import { purgeExpiredRows } from './purge';
import { registerRunJobNow } from './run-job-now';

export function register(_app: FastifyInstance, _deps: Deps): void {
  registerJob({ name: 'purgeExpiredRows', schedule: { everyMs: 3_600_000 }, run: purgeExpiredRows });
  registerRunJobNow();
}
