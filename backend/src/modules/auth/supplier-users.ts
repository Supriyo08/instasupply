/** inviteSupplierUser and setSupplierUserStatus (MARKETPLACE §5.4 rows; docs/PLATFORM.md §5.2, §7.4). */
import type {
  InviteSupplierUserRequest,
  InviteSupplierUserResponse,
  OkResponse,
  SetSupplierUserStatusRequest,
} from '@instasupply/shared';
import { requireAuth } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { defineCommand } from '../../platform/http/command';
import { failedPrecondition, notFound, permissionDenied } from '../../platform/http/errors';
import { use } from '../../platform/http/rate-limit';
import { inviteUser } from './account.service';
import { InviteSupplierUserRequestSchema, SetSupplierUserStatusRequestSchema } from './schemas';
import { applyAccountStatus } from './staff';
import { lockUser } from './users.repository';

export function registerSupplierUserCommands(): void {
  defineCommand<InviteSupplierUserRequest, InviteSupplierUserResponse>({
    name: 'inviteSupplierUser',
    // Staff: any store, any store role. An owner: their own store, role `staff` only (§5.2).
    policy: (ctx) => {
      const actor = requireAuth(ctx);
      if (actor.isStaff) return actor;
      if (actor.role !== 'supplier' || !actor.isActive || actor.storeRole !== 'owner') permissionDenied();
      return actor;
    },
    schema: InviteSupplierUserRequestSchema,
    limits: (ctx) => [use('invite', ctx.actor!.uid)],
    handler: async (ctx, req, actor) => {
      if (!actor!.isStaff) {
        if (req.storeId !== actor!.storeId) permissionDenied();
        if (req.storeRole !== 'staff') permissionDenied('Store owners can invite staff members only.');
      }
      return withTransaction(ctx.deps, async (tx) => {
        const { rows } = await tx.query('SELECT 1 FROM stores WHERE id = $1', [req.storeId]);
        if (rows.length === 0) notFound('That store does not exist.');
        return inviteUser(tx, ctx.deps.config, {
          email: req.email,
          displayName: req.displayName,
          role: 'supplier',
          storeId: req.storeId,
          storeRole: req.storeRole,
          invitedBy: actor!.uid,
          doc: { preferences: { chatPush: true, storeOrderPush: true } },
        });
      });
    },
  });

  defineCommand<SetSupplierUserStatusRequest, OkResponse>({
    name: 'setSupplierUserStatus',
    policy: (ctx) => {
      const actor = requireAuth(ctx);
      if (actor.isStaff) return actor;
      if (actor.role !== 'supplier' || !actor.isActive || actor.storeRole !== 'owner') permissionDenied();
      return actor;
    },
    schema: SetSupplierUserStatusRequestSchema,
    handler: async (ctx, req, actor) => {
      if (req.uid === actor!.uid) permissionDenied('You cannot change the status of your own account.');
      await withTransaction(ctx.deps, async (tx) => {
        const target = await lockUser(tx, req.uid);
        if (!target) notFound('That account does not exist.');
        if (target.role !== 'supplier') failedPrecondition('That account is not a supplier user.');
        // The store comes from the database rows of both users, never from the request (§7.4).
        if (!actor!.isStaff && target.store_id !== actor!.storeId) permissionDenied();
        if (target.status === req.status) return;
        await applyAccountStatus(tx, target, req.status, req.reason ?? null);
      });
      return { ok: true };
    },
  });
}
