/**
 * The ops module (docs/PLATFORM.md §2.1, §15.2 `money-comms`): dashboard, store statistics, job state, the dev
 * outbox and the transactional outbox (§5.3.10).
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerOpsRoutes } from './routes';

export { buildDashboard } from './dashboard';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerOpsRoutes(app);
}
