/** The auth endpoints and GET /me (docs/PLATFORM.md §5.3.2). HTTP only: schema, policy, call the service. */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../platform/auth/policies';
import { defineRoute } from '../../platform/http/route';
import {
  changePassword,
  forgotPassword,
  inspectInvite,
  login,
  logout,
  logoutAll,
  refresh,
  register,
  resetPassword,
  setupPassword,
} from './account.service';
import {
  ChangeRequestSchema,
  ForgotRequestSchema,
  InspectRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResetRequestSchema,
  SetupPasswordRequestSchema,
} from './schemas';
import { loadMe } from './serializers';

/** 256 KiB for /auth/* (§4.7). */
const AUTH_BODY_LIMIT = 256 * 1024;

export function registerAuthRoutes(app: FastifyInstance): void {
  const auth = { bodyLimit: AUTH_BODY_LIMIT } as const;

  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/register',
    policy: 'public',
    body: RegisterRequestSchema,
    handler: (ctx, { body }, _actor, request) => register(ctx, request, body),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/login',
    policy: 'public',
    body: LoginRequestSchema,
    handler: (ctx, { body }, _actor, request) => login(ctx, request, body),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/refresh',
    policy: 'public',
    body: RefreshRequestSchema,
    handler: (ctx, { body }) => refresh(ctx, body.refreshToken),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/logout',
    policy: 'public',
    body: RefreshRequestSchema,
    status: 204,
    handler: (ctx, { body }) => logout(ctx, body.refreshToken),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/logout-all',
    policy: requireAuth,
    status: 204,
    handler: (ctx, _input, actor) => logoutAll(ctx, actor!.uid),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/password/forgot',
    policy: 'public',
    body: ForgotRequestSchema,
    status: 204,
    handler: (ctx, { body }) => forgotPassword(ctx, body.email),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/password/reset',
    policy: 'public',
    body: ResetRequestSchema,
    status: 204,
    handler: (ctx, { body }) => resetPassword(ctx, body),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/password/change',
    policy: requireAuth,
    body: ChangeRequestSchema,
    status: 204,
    handler: (ctx, { body }, actor) => changePassword(ctx, actor!, body),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/invites/inspect',
    policy: 'public',
    body: InspectRequestSchema,
    handler: (ctx, { body }) => inspectInvite(ctx, body.token),
  });
  defineRoute(app, {
    ...auth,
    method: 'POST',
    url: '/auth/password/setup',
    policy: 'public',
    body: SetupPasswordRequestSchema,
    handler: (ctx, { body }, _actor, request) => setupPassword(ctx, request, body),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/me',
    policy: requireAuth,
    handler: (ctx, _input, actor) => loadMe(ctx.deps.pool, actor!.uid, ctx.origin, ctx.deps.clock.now()),
  });
}
