/**
 * The suggestions module (docs/PLATFORM.md §2.1, §15.2 `money-comms`): the public `suggestStore` command and
 * the staff endpoints of §5.3.8.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerSuggestionRoutes } from './routes';
import { registerSuggestStore } from './suggest-store';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerSuggestStore();
  registerSuggestionRoutes(app);
}
