/**
 * modules/jobs (workstream `deliveries`, docs/PLATFORM.md §15.2): the job board, `claimJob`,
 * `boostJobPayout`, the `publishDueJobOffers` job and the §9.1 helpers `stageJobOffer` / `deleteJobOffer`.
 */
import type {
  BoostJobPayoutRequest,
  ClaimJobRequest,
  ClaimJobResponse,
  OkResponse,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../container';
import { requireActiveDriver, requireStaff } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import { registerJob } from '../../platform/scheduler/registry';
import { boostJobPayout } from './boost';
import { claimJob } from './claim-job';
import { runPublishDueJobOffers } from './publish-due-offers';
import { registerJobRoutes } from './routes';

export { deleteJobOffer, stageJobOffer } from './offers';

const ClaimJobRequestSchema = z
  .object({ deliveryId: z.string().trim().min(1).max(100) })
  .strict() satisfies z.ZodType<ClaimJobRequest>;

const BoostJobPayoutRequestSchema = z
  .object({
    deliveryId: z.string().trim().min(1).max(100),
    addCents: z.union([z.literal(500), z.literal(1000), z.literal(1500), z.literal(2000)]),
  })
  .strict() satisfies z.ZodType<BoostJobPayoutRequest>;

export function register(app: FastifyInstance, _deps: Deps): void {
  registerJobRoutes(app);
  defineCommand<ClaimJobRequest, ClaimJobResponse>({
    name: 'claimJob',
    policy: requireActiveDriver,
    schema: ClaimJobRequestSchema,
    handler: (ctx, req, actor) => claimJob(ctx, actor!, req),
  });
  defineCommand<BoostJobPayoutRequest, OkResponse>({
    name: 'boostJobPayout',
    policy: requireStaff,
    schema: BoostJobPayoutRequestSchema,
    handler: (ctx, req, actor) => boostJobPayout(ctx, actor!, req),
  });
  registerJob({
    name: 'publishDueJobOffers',
    schedule: { everyMs: 5 * 60_000 },
    run: runPublishDueJobOffers,
  });
}
