/**
 * `sendTestNotification` (docs/PLATFORM.md §5.2, §10.2): inserts a `test` notification for the caller (it is
 * pushed like any other) and answers the number of the caller's `devices` rows. Unchanged from the legacy
 * callable.
 */
import type { SendTestNotificationResponse } from '@instasupply/shared';
import { z } from 'zod';
import { requireAuth } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { defineCommand } from '../../platform/http/command';
import { notify } from './notify';
import { countDevices } from './repository';

export const SendTestNotificationRequestSchema = z.object({}).strict();

export function registerTestNotification(): void {
  defineCommand<Record<string, never>, SendTestNotificationResponse>({
    name: 'sendTestNotification',
    policy: requireAuth,
    schema: SendTestNotificationRequestSchema,
    handler: async (ctx, _req, actor) => {
      const uid = actor!.uid;
      await withTransaction(ctx.deps, (tx) =>
        notify(tx, uid, {
          type: 'test',
          title: 'Test notification',
          body: 'Push notifications are working on this device.',
        }),
      );
      return { devices: await countDevices(ctx.deps.pool, uid) };
    },
  });
}
