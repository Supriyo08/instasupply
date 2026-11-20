/**
 * The support module (docs/PLATFORM.md §2.1, §15.2 `money-comms`): customer and store support threads
 * (§5.3.6) and `postSupportMessage`, which `reopenQuote` (quotes) calls through this barrel.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerSupportRoutes } from './routes';

export { ownsSupportThread, senderRoleOf } from './access';
export { postSupportMessage, type PostSupportMessageInput, type PostSupportMessageResult } from './messages';
export { toSupportMessage, toSupportThread } from './repository';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerSupportRoutes(app);
}
