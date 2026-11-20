/**
 * modules/issues (docs/PLATFORM.md §2.1, §5.2, §5.3.7, §9.2.11; owner `quotes-issues`, §15.2): problem reports on
 * completed store orders and their resolution with a refund (and clawbacks), a replacement order or no action.
 * It owns no §9.1 helper.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerIssueCommands, registerIssueRoutes } from './routes';

export { canReadIssue } from './routes';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerIssueCommands();
  registerIssueRoutes(app);
}
