/**
 * The chat module (docs/PLATFORM.md §2.1, §15.2 `money-comms`): the dispatch ↔ driver threads of §5.3.6 and
 * `postChatMessage` (was `onChatMessageCreated`).
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerChatRoutes } from './routes';

export { postChatMessage, type PostChatMessageInput } from './messages';
export { toChatMessage, toChatThread } from './repository';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerChatRoutes(app);
}
