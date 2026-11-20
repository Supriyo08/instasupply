/**
 * `PUT /me/devices/{installationId}` and `DELETE /me/devices/{installationId}` (docs/PLATFORM.md §5.3.3): any
 * signed-in account registers the push token of the install it is signed in on. `provider` must be `expo`;
 * `devices.app` is copied from the session (the body has no `app`); `installationId` must be the session's,
 * else `permission-denied`. Registering deletes every other row with the same token (§9.4 `onDeviceWritten`).
 */
import type { DeviceInput } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../platform/auth/policies';
import { pgCode, RetryTransaction, withTransaction } from '../../platform/db/tx';
import { permissionDenied } from '../../platform/http/errors';
import { defineRoute } from '../../platform/http/route';
import { deleteDevice, sessionInstall, upsertDevice } from './devices.repository';

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const DeviceInputSchema = z
  .object({
    token: z.string().trim().min(10).max(4096),
    provider: z.literal('expo'),
    platform: z.enum(['ios', 'android', 'web']),
    appVersion: optionalText(40),
    deviceName: optionalText(80),
  })
  .strict() satisfies z.ZodType<DeviceInput, unknown>;

const installParams = z.object({ installationId: z.string().min(8).max(80) });

export function registerDeviceRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'PUT',
    url: '/me/devices/:installationId',
    policy: requireAuth,
    params: installParams,
    body: DeviceInputSchema,
    status: 204,
    handler: async (ctx, { params, body }, actor) => {
      const me = actor!;
      const session = await sessionInstall(ctx.deps.pool, me.sessionId);
      if (!session || session.installation_id !== params.installationId) {
        permissionDenied('Register the push token of the device you are signed in on.');
      }
      await withTransaction(ctx.deps, async (tx) => {
        try {
          await upsertDevice(tx, {
            userId: me.uid,
            installationId: params.installationId,
            token: body.token,
            platform: body.platform,
            app: session.app,
            appVersion: body.appVersion,
            deviceName: body.deviceName,
          });
        } catch (error) {
          // Another account registered the same token at the same moment: run again, the later one wins.
          if (pgCode(error) === '23505') throw new RetryTransaction('device token taken concurrently');
          throw error;
        }
      });
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/me/devices/:installationId',
    policy: requireAuth,
    params: installParams,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      await withTransaction(ctx.deps, (tx) => deleteDevice(tx, actor!.uid, params.installationId));
    },
  });
}
