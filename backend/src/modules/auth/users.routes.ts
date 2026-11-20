/** GET /users and GET /users/{uid} (docs/PLATFORM.md §5.3.2, §7.3). */
import type { Page, UserProfile } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../platform/auth/policies';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { requireProfile } from './serializers';
import { findUserById, type UserRecord } from './users.repository';

const ROLES = ['admin', 'dispatcher', 'driver', 'customer', 'supplier'] as const;

/**
 * One role or several, comma-separated (`?role=admin,dispatcher`): the console's Team page lists every
 * staff account in one request, and the api-client joins array parameters with commas.
 */
const roleList = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : Array.isArray(value)
        ? value.flatMap((part) =>
            String(part)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          )
        : value,
  z.array(z.enum(ROLES)).min(1).max(ROLES.length),
);

const listQuery = pageQuerySchema.extend({
  role: roleList.optional(),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  cityId: z.string().min(1).max(40).optional(),
  storeId: z.string().min(1).max(40).optional(),
  sort: z.enum(['createdAt:desc', 'createdAt:asc']).default('createdAt:desc'),
});

const COLUMNS = `id, email, password_hash, failed_logins, role, status, display_name, phone_number, phone_verified,
  store_id, store_role, city_id, capacity_class, doc, created_at, updated_at`;

export function registerUserRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/users',
    policy: requireAuth,
    query: listQuery,
    handler: async (ctx, { query }, actor): Promise<Page<UserProfile>> => {
      const caller = actor!;
      if (!caller.isStaff) {
        // The old rule: an owner lists the supplier users of their own store (index 37), nothing else.
        const ownTeam =
          caller.role === 'supplier' &&
          caller.isActive &&
          caller.storeRole === 'owner' &&
          query.role?.length === 1 &&
          query.role[0] === 'supplier' &&
          query.storeId === caller.storeId &&
          query.cityId === undefined;
        if (!ownTeam) permissionDenied();
      }
      const desc = query.sort === 'createdAt:desc';
      const where: string[] = ['role IS NOT NULL'];
      const values: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
      };
      if (query.role) add('role = ANY(?::text[])', [...new Set(query.role)]);
      if (query.status) add('status = ?', query.status);
      if (query.cityId) add('city_id = ?', query.cityId);
      if (query.storeId) add('store_id = ?', query.storeId);
      if (query.cursor) {
        const [at, id] = decodeCursor(query.cursor);
        if (typeof at !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
        values.push(new Date(at), id);
        where.push(`(created_at, id) ${desc ? '<' : '>'} ($${values.length - 1}, $${values.length})`);
      }
      values.push(query.limit + 1);
      const order = desc ? 'created_at DESC, id DESC' : 'created_at ASC, id ASC';
      const { rows } = await ctx.deps.pool.query<UserRecord>(
        `SELECT ${COLUMNS} FROM users WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${values.length}`,
        values,
      );
      return readPage(
        rows,
        query.limit,
        (row) => requireProfile(row, ctx.origin),
        (row) => [row.created_at, row.id],
      );
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/users/:uid',
    policy: requireAuth,
    params: z.object({ uid: idParam }),
    handler: async (ctx, { params }, actor): Promise<UserProfile> => {
      if (!actor!.isStaff && actor!.uid !== params.uid) permissionDenied();
      const row = await findUserById(ctx.deps.pool, params.uid);
      if (!row || row.role === null) notFound('That account does not exist.');
      return requireProfile(row, ctx.origin);
    },
  });
}
