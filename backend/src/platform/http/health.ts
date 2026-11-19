/** GET /api/v1/health and GET /api/v1/config (docs/PLATFORM.md §5.3.1). Both public, never cached. */
import type { HealthResponse } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { serverVersion } from '../../config/env';
import { publicConfig } from '../../config/public-config';
import { ApiError } from './errors';
import { defineRoute } from './route';

export const VERSION = serverVersion();

/** `SELECT 1` within 2 s, on a fresh checkout so a stuck pool also shows as unhealthy. */
async function databaseAnswers(deps: Deps): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000).unref());
  const check = deps.pool.query('SELECT 1').then(
    () => true,
    () => false,
  );
  return Promise.race([check, timeout]);
}

export function registerHealthRoutes(app: FastifyInstance, deps: Deps): void {
  defineRoute(app, {
    method: 'GET',
    url: '/health',
    policy: 'public',
    handler: async (): Promise<HealthResponse> => {
      if (!(await databaseAnswers(deps))) {
        throw new ApiError('unavailable', 'The database does not answer.', null, { retryAfterMs: 1000 });
      }
      return { status: 'ok', version: VERSION, serverTime: deps.clock.now() };
    },
  });
  defineRoute(app, {
    method: 'GET',
    url: '/config',
    policy: 'public',
    handler: async () => publicConfig(deps.config, deps.clock.now()),
  });
}
