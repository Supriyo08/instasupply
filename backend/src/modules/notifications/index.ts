/**
 * The notifications module (docs/PLATFORM.md §2.1, §10.2, §15.2 `money-comms`): the inbox writers of §9.1
 * (notify.ts), the inbox and push-device endpoints of §5.3.3 and `sendTestNotification`. The `push.send` handler and the
 * receipt job are platform code (platform/push). Other modules call the writers through this barrel.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerDeviceRoutes } from './devices.routes';
import { registerInboxRoutes } from './inbox.routes';
import { registerTestNotification } from './test-notification';

export {
  notify,
  notifyDrivers,
  notifyStaff,
  notifyStoreMembers,
  notifyUsers,
  type NotificationInput,
} from './notify';
export { toNotification } from './repository';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerInboxRoutes(app);
  registerDeviceRoutes(app);
  registerTestNotification();
}
