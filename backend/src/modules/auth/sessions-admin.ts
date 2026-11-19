/** Session lists and revocation for the caller and for admins (docs/PLATFORM.md §5.3.2). */
import type { Page, SessionInfo } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../platform/auth/policies';
import { revokeAllSessions, revokeSession } from '../../platform/auth/sessions';
import { withTransaction } from '../../platform/db/tx';
import { notFound, permissionDenied } from '../../platform/http/errors';
import { defineRoute, idParam } from '../../platform/http/route';
import { publishControl } from '../../platform/live/publish';
import { toSessionInfo, type SessionRecord } from './serializers';

/** Active sessions of one user, most recently used first; at most 10 exist, so one page holds them all. */
async function activeSessions(
  pool: pg.Pool,
  uid: string,
  now: number,
  currentId: string | null,
): Promise<Page<SessionInfo>> {
  const { rows } = await pool.query<SessionRecord>(
    `SELECT id, app, platform, device_name, created_at, last_used_at FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY last_used_at DESC, id DESC`,
    [uid, new Date(now)],
  );
  return { items: rows.map((row) => toSessionInfo(row, currentId)), nextCursor: null };
}

export function registerSessionRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/auth/sessions',
    policy: requireAuth,
    handler: (ctx, _input, actor) =>
      activeSessions(ctx.deps.pool, actor!.uid, ctx.deps.clock.now(), actor!.sessionId),
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/auth/sessions/:sessionId',
    policy: requireAuth,
    params: z.object({ sessionId: idParam }),
    status: 204,
    handler: async (ctx, { params }, actor) => {
      const { rows } = await ctx.deps.pool.query<{ user_id: string }>(
        'SELECT user_id FROM sessions WHERE id = $1',
        [params.sessionId],
      );
      if (!rows[0]) notFound('That session does not exist.');
      if (rows[0].user_id !== actor!.uid) permissionDenied();
      await withTransaction(ctx.deps, (tx) => revokeSession(tx, params.sessionId, 'logout'));
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/users/:uid/sessions',
    policy: requireAdmin,
    params: z.object({ uid: idParam }),
    handler: async (ctx, { params }) => {
      const { rows } = await ctx.deps.pool.query('SELECT 1 FROM users WHERE id = $1', [params.uid]);
      if (rows.length === 0) notFound('That account does not exist.');
      return activeSessions(ctx.deps.pool, params.uid, ctx.deps.clock.now(), null);
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/users/:uid/sessions/revoke-all',
    policy: requireAdmin,
    params: z.object({ uid: idParam }),
    status: 204,
    handler: async (ctx, { params }, actor) => {
      if (params.uid === actor!.uid) permissionDenied('Use "Sign out everywhere" for your own account.');
      await withTransaction(ctx.deps, async (tx) => {
        const { rows } = await tx.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [params.uid]);
        if (rows.length === 0) notFound('That account does not exist.');
        await revokeUserSessions(tx, params.uid);
      });
    },
  });
}

/** Revokes every session with reason `admin` and drops the user's sockets (also the revoke-sessions CLI). */
export async function revokeUserSessions(
  tx: Parameters<typeof revokeAllSessions>[0],
  uid: string,
): Promise<number> {
  const revoked = await revokeAllSessions(tx, uid, 'admin');
  await publishControl(tx, { ctl: 'drop_user', uid });
  return revoked.length;
}
