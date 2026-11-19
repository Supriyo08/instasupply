/**
 * Staff accounts: createStaffUser (an invite with a set-password link) and PATCH /users/{uid}/status for
 * admins, dispatchers and customers (docs/PLATFORM.md §5.2, §5.3.2, §6.4 "What suspension does").
 */
import type { CreateStaffUserRequest, CreateStaffUserResponse, UserProfile } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../platform/auth/policies';
import { revokeAllSessions, setDriverOffline } from '../../platform/auth/sessions';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { defineCommand } from '../../platform/http/command';
import { failedPrecondition, notFound, permissionDenied } from '../../platform/http/errors';
import { use } from '../../platform/http/rate-limit';
import { defineRoute, idParam } from '../../platform/http/route';
import { publishControl } from '../../platform/live/publish';
import { notifyStaff } from '../notifications/notify';
import { inviteUser } from './account.service';
import { CreateStaffUserRequestSchema, UserStatusPatchSchema } from './schemas';
import { requireProfile } from './serializers';
import { lockUser, setStatus, type UserRecord } from './users.repository';

/**
 * Suspension or reactivation in the caller's transaction (§6.4): status and reason; on suspension every
 * session revoked with reason `suspended`, the driver offline, and `drop_user` so every instance closes the
 * user's sockets. Reactivation only sets the status back; the user signs in again.
 */
export async function applyAccountStatus(
  tx: Tx,
  user: UserRecord,
  status: 'active' | 'suspended',
  reason: string | null,
): Promise<void> {
  await setStatus(tx, user, status, reason);
  if (status !== 'suspended') return;
  await revokeAllSessions(tx, user.id, 'suspended');
  if (user.role === 'driver') await setDriverOffline(tx, user.id);
  await publishControl(tx, { ctl: 'drop_user', uid: user.id });
}

export function registerStaffCommands(): void {
  defineCommand<CreateStaffUserRequest, CreateStaffUserResponse>({
    name: 'createStaffUser',
    policy: requireAdmin,
    schema: CreateStaffUserRequestSchema,
    limits: (ctx) => [use('invite', ctx.actor!.uid)],
    handler: (ctx, req, actor) =>
      withTransaction(ctx.deps, (tx) =>
        inviteUser(tx, ctx.deps.config, {
          email: req.email,
          displayName: req.displayName,
          role: req.role,
          invitedBy: actor!.uid,
          doc: { preferences: { chatPush: true, deliveryPush: true } },
        }),
      ),
  });
}

const STATUS_ROLES = new Set(['admin', 'dispatcher', 'customer']);

export function registerStaffRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'PATCH',
    url: '/users/:uid/status',
    policy: requireAdmin,
    params: z.object({ uid: idParam }),
    body: UserStatusPatchSchema,
    handler: async (ctx, { params, body }, actor): Promise<UserProfile> => {
      if (params.uid === actor!.uid) permissionDenied('You cannot change the status of your own account.');
      const user = await withTransaction(ctx.deps, async (tx) => {
        const target = await lockUser(tx, params.uid);
        if (!target) notFound('That account does not exist.');
        if (!target.role || !STATUS_ROLES.has(target.role)) {
          failedPrecondition('Drivers and supplier users have their own status actions.');
        }
        if (target.status === body.status) return target;
        if (body.status === 'suspended' && target.role === 'admin') {
          const { rows } = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1`,
            [target.id],
          );
          if ((rows[0]?.n ?? 0) === 0) failedPrecondition('At least one administrator must stay active.');
        }
        await applyAccountStatus(tx, target, body.status, body.reason);
        await notifyStaff(
          tx,
          {
            type: 'system',
            title: body.status === 'suspended' ? 'Account suspended' : 'Account reactivated',
            body: `${actor!.name || 'An administrator'} ${body.status === 'suspended' ? 'suspended' : 'reactivated'} ${target.display_name || 'an account'}.`,
            key: `status-${target.id}-${tx.now}`,
          },
          { adminsOnly: true, exclude: actor!.uid },
        );
        return (await lockUser(tx, target.id))!;
      });
      return requireProfile(user, ctx.origin);
    },
  });
}
