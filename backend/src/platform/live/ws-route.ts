/** GET /api/v1/live (docs/PLATFORM.md §8.1). Anonymous sockets are allowed; the token comes in a frame. */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { clientAddress } from '../http/client-address';
import { isAllowedOrigin } from '../http/cors';
import { ApiError } from '../http/errors';

export function registerLiveRoute(app: FastifyInstance, deps: Deps): void {
  app.get(
    '/api/v1/live',
    {
      websocket: true,
      config: { policy: 'public' },
      // An upgrade with an Origin that CORS would refuse is a page on another site: refuse it (403). A request
      // without Origin (native apps, scripts) is accepted.
      onRequest: async (request) => {
        const origin = request.headers.origin;
        if (origin !== undefined && !isAllowedOrigin(origin, deps.config)) {
          throw new ApiError('permission-denied', 'This origin may not open a live connection.');
        }
      },
    },
    (socket, request) => {
      deps.live.accept(socket, clientAddress(request.raw, deps.config));
    },
  );
}
