/** runJobNow (docs/PLATFORM.md §9.5): admins, and only when ALLOW_TEST_JOBS=true. */
import type { RunJobNowRequest, RunJobNowResponse, ScheduledJobName } from '@instasupply/shared';
import { z } from 'zod';
import { requireAdmin } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import { notFound, permissionDenied } from '../../platform/http/errors';
import { jobFor } from '../../platform/scheduler/registry';

export const SCHEDULED_JOBS = [
  'escalateStoreOrders',
  'expirePickupHolds',
  'publishDueJobOffers',
  'markStaleDriversOffline',
  'expireQuotes',
  'runDailyPayouts',
  'captureDuePayments',
] as const satisfies readonly ScheduledJobName[];

export const RunJobNowRequestSchema = z
  .object({
    job: z.enum(SCHEDULED_JOBS),
    now: z.number().int().positive().nullable().optional(),
  })
  .strict() satisfies z.ZodType<RunJobNowRequest>;

export function registerRunJobNow(): void {
  defineCommand<RunJobNowRequest, RunJobNowResponse>({
    name: 'runJobNow',
    policy: (ctx) => {
      const actor = requireAdmin(ctx);
      if (!ctx.deps.config.ALLOW_TEST_JOBS)
        permissionDenied('Running jobs by hand is switched off on this server.');
      return actor;
    },
    schema: RunJobNowRequestSchema,
    handler: async (ctx, req) => {
      if (!jobFor(req.job)) notFound(`The job ${req.job} is not available on this server yet.`);
      const now = req.now ?? ctx.deps.clock.now();
      const result = await ctx.deps.scheduler.runJob(req.job, now);
      await ctx.deps.outbox.drain();
      return { job: req.job, now, result };
    },
  });
}
