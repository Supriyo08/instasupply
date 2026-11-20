/** modules/account: the caller's own data (docs/PLATFORM.md §5.3.3), owned by the `commerce` workstream. */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerAccountRoutes } from './routes';

export { touchJobsite } from './jobsites.repository';

export function register(app: FastifyInstance, _deps: Deps): void {
  registerAccountRoutes(app);
}
