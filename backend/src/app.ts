/**
 * buildApp(deps): the Fastify instance with every plugin and route (docs/PLATFORM.md §2.1). It calls each
 * module's `register(app, deps)` and nothing else from the module.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { Deps } from './container';
import { authenticateHeader } from './platform/auth/authenticate';
import { hmacHex } from './platform/crypto';
import { clientAddress, publicOrigin } from './platform/http/client-address';
import { registerCommandRoute } from './platform/http/command';
import type { RequestContext } from './platform/http/context';
import { corsOptions } from './platform/http/cors';
import { installErrorHandlers } from './platform/http/error-handler';
import { registerHealthRoutes } from './platform/http/health';
import { memoryLimiterOptions } from './platform/http/rate-limit';
import { helmetOptions } from './platform/http/security-headers';
import { newId } from './platform/ids';
import { registerLiveRoute } from './platform/live/ws-route';
import { MAX_FRAME_BYTES } from './platform/live/protocol';
import { registerMailHandler } from './platform/mail/mail.handler';
import { registerPushHandler } from './platform/push/push.handler';
import { registerPushReceiptsJob } from './platform/push/receipts.job';
import { registerSmsHandler } from './platform/sms/sms.handler';
import { registerFileRoutes } from './platform/storage/files.routes';
import * as account from './modules/account';
import * as auth from './modules/auth';
import * as chat from './modules/chat';
import * as commerce from './modules/commerce';
import * as deliveries from './modules/deliveries';
import * as drivers from './modules/drivers';
import * as geocoding from './modules/geocoding';
import * as issues from './modules/issues';
import * as jobs from './modules/jobs';
import * as maintenance from './modules/maintenance';
import * as notifications from './modules/notifications';
import * as ops from './modules/ops';
import * as payments from './modules/payments';
import * as payouts from './modules/payouts';
import * as quotes from './modules/quotes';
import * as routing from './modules/routing';
import * as storeOrders from './modules/store-orders';
import * as stores from './modules/stores';
import * as suggestions from './modules/suggestions';
import * as support from './modules/support';
import * as tracking from './modules/tracking';

/** Every module of §2.1, in the order of MARKETPLACE §5.1. */
const MODULES: { register(app: FastifyInstance, deps: Deps): void }[] = [
  auth,
  drivers,
  account,
  commerce,
  payments,
  stores,
  storeOrders,
  deliveries,
  jobs,
  routing,
  tracking,
  geocoding,
  maintenance,
  quotes,
  issues,
  support,
  suggestions,
  payouts,
  notifications,
  chat,
  ops,
];

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { config } = deps;
  // Fastify infers its logger type from loggerInstance (pino's Logger); every route helper takes the default
  // instance type, and pino's Logger is a FastifyBaseLogger at run time.
  const app = Fastify({
    loggerInstance: deps.log,
    // Fastify's own "incoming request" / "request completed" lines carry req.url and remoteAddress (§4.3).
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'reqId' }),
    trustProxy: false,
    requestIdHeader: false,
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      return typeof inbound === 'string' && REQUEST_ID.test(inbound) ? inbound : newId();
    },
    return503OnClosing: true,
    bodyLimit: 1_048_576,
    routerOptions: { maxParamLength: 100 },
  }) as unknown as FastifyInstance;

  installErrorHandlers(app);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    const client = request.headers['x-client'];
    const authentication = await authenticateHeader(deps, request.headers.authorization);
    const ctx: RequestContext = {
      actor: authentication.actor,
      authFailure: authentication.failure,
      ip: clientAddress(request.raw, config),
      requestId: request.id,
      log: request.log,
      deps,
      origin: publicOrigin(request.raw, config),
      client: typeof client === 'string' ? client.slice(0, 100) : null,
    };
    request.ctx = ctx;
    const railway = request.headers['x-railway-request-id'];
    if (typeof railway === 'string')
      request.log = request.log.child({ railwayRequestId: railway.slice(0, 80) });
  });

  // JSON is never cached; media sets its own Cache-Control (§4.8, §10.1).
  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // The one completion line per request (§4.3): no URL, no address, no body.
  app.addHook('onResponse', async (request, reply) => {
    const ctx = request.ctx as RequestContext | undefined;
    const route = request.routeOptions.url;
    const params = request.params as { name?: unknown } | undefined;
    const line = {
      method: request.method,
      route,
      command:
        request.routeOptions.config.commandRoute && typeof params?.name === 'string'
          ? params.name.slice(0, 64)
          : undefined,
      statusCode: reply.statusCode,
      responseTime: Math.round(reply.elapsedTime),
      uid: ctx?.actor?.uid,
      role: ctx?.actor?.role ?? undefined,
      ip: ctx ? hmacHex('ip', ctx.ip).slice(0, 16) : undefined,
      client: ctx?.client ?? undefined,
    };
    if (reply.statusCode >= 500) request.log.error(line, 'request failed');
    else request.log.info(line, 'request completed');
  });

  await app.register(cors, corsOptions(config));
  await app.register(helmet, helmetOptions(config));
  await app.register(rateLimit, memoryLimiterOptions(config));
  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });
  if (deps.storage.driver === 'local') {
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } });
  }

  registerHealthRoutes(app, deps);
  registerCommandRoute(app);
  registerFileRoutes(app, deps);
  registerLiveRoute(app, deps);

  registerSmsHandler();
  registerMailHandler();
  registerPushHandler();
  registerPushReceiptsJob();
  for (const module of MODULES) module.register(app, deps);

  return app;
}
