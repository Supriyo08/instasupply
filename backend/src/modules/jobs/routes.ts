/**
 * The job board (docs/PLATFORM.md §5.3.5, §7.4): `GET /job-offers` and `GET /job-offers/{deliveryId}`. A
 * driver's board is always the open offers of their own `{cityId}:{capacityClass}`, from their row.
 */
import type { JobOffer, Page, WithId } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../../platform/auth/actor';
import { audienceKey, requireActiveDriver, requireAuth } from '../../platform/auth/policies';
import type { RequestContext } from '../../platform/http/context';
import { notFound, permissionDenied } from '../../platform/http/errors';
import { MAX_LIMIT } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { canSeeOffer } from '../deliveries/access';
import { findOffer, listOffers, listOpenOffersFor } from './repository';

/** Staff, or an active driver with an approved vehicle. */
function requireBoardReader(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.isStaff) return actor;
  return requireActiveDriver(ctx);
}

const statuses = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(['scheduled', 'open'])).min(1));

const listQuery = z
  .object({
    status: statuses.optional(),
    sort: z.enum(['openedAt:desc', 'opensAt:asc']).default('openedAt:desc'),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
    cursor: z.string().max(500).optional(),
  })
  .strict();

export function registerJobRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/job-offers',
    policy: requireBoardReader,
    query: listQuery,
    handler: async (ctx, { query }, actor): Promise<Page<WithId<JobOffer>>> => {
      const caller = actor!;
      const items = caller.isStaff
        ? await listOffers(ctx.deps.pool, {
            statuses: query.status ?? ['open'],
            sort: query.sort,
            limit: query.limit,
          })
        : await listOpenOffersFor(ctx.deps.pool, audienceKey(caller), query.limit);
      return { items, nextCursor: null };
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/job-offers/:deliveryId',
    policy: requireBoardReader,
    params: z.object({ deliveryId: idParam }),
    handler: async (ctx, { params }, actor): Promise<WithId<JobOffer>> => {
      const offer = await findOffer(ctx.deps.pool, params.deliveryId);
      if (!offer) notFound('This job is no longer available.');
      if (!canSeeOffer(actor!, offer)) {
        if (offer.status !== 'open') notFound('This job is no longer available.');
        permissionDenied();
      }
      return offer;
    },
  });
}
