/**
 * `PATCH /users/{uid}/payout-account` (admin, docs/PLATFORM.md §5.3.2): a driver's payout account, set by ops
 * after Connect onboarding (MARKETPLACE §3.9). The user must be a driver.
 */
import type { PayoutAccountPatch, UserProfile } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, notFound } from '../../platform/http/errors';
import { defineRoute, idParam } from '../../platform/http/route';
import { requireProfile } from '../auth/serializers';
import { findUserById } from '../auth/users.repository';
import { lockUserRow, updateUser } from './repository';
import { PayoutAccountPatchSchema } from './schemas';

export function registerDriverRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'PATCH',
    url: '/users/:uid/payout-account',
    policy: requireAdmin,
    params: z.object({ uid: idParam }),
    body: PayoutAccountPatchSchema,
    handler: async (ctx, { params, body }): Promise<UserProfile> => {
      const patch: PayoutAccountPatch = body;
      await withTransaction(ctx.deps, async (tx) => {
        const row = await lockUserRow(tx, params.uid);
        if (!row || row.role === null) notFound('That account does not exist.');
        if (row.role !== 'driver') failedPrecondition('Only a driver has a payout account on the profile.');
        await updateUser(tx, params.uid, { doc: { payoutAccount: patch.payoutAccount } });
      });
      const record = await findUserById(ctx.deps.pool, params.uid);
      if (!record) notFound('That account does not exist.');
      return requireProfile(record, ctx.origin);
    },
  });
}
