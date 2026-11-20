/**
 * Store suggestions for ops (docs/PLATFORM.md §5.3.8): `GET /store-suggestions` and
 * `PATCH /store-suggestions/{id}` (only `status`), staff only.
 */
import type { Page, StoreSuggestion, WithId } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStaff } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { invalidArgument, notFound } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { listSuggestions, setSuggestionStatus, suggestionCursorKey, toStoreSuggestion } from './repository';

const status = z.enum(['new', 'contacted', 'onboarding', 'dismissed']);
const ListQuerySchema = pageQuerySchema
  .extend({ status: status.optional(), sort: z.enum(['createdAt:desc']).optional() })
  .strict();
export const SuggestionPatchSchema = z.object({ status }).strict();

function cursorOf(cursor: string | undefined): [number, string] | null {
  if (cursor === undefined) return null;
  const [value, id] = decodeCursor(cursor);
  if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
  return [value, id];
}

export function registerSuggestionRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/store-suggestions',
    policy: requireStaff,
    query: ListQuerySchema,
    handler: async (ctx, { query }): Promise<Page<WithId<StoreSuggestion>>> => {
      const rows = await listSuggestions(
        ctx.deps.pool,
        query.status ?? null,
        cursorOf(query.cursor),
        query.limit,
      );
      return readPage(rows, query.limit, toStoreSuggestion, suggestionCursorKey);
    },
  });

  defineRoute(app, {
    method: 'PATCH',
    url: '/store-suggestions/:id',
    policy: requireStaff,
    params: z.object({ id: idParam }),
    body: SuggestionPatchSchema,
    handler: async (ctx, { params, body }): Promise<WithId<StoreSuggestion>> => {
      const saved = await withTransaction(ctx.deps, (tx) => setSuggestionStatus(tx, params.id, body.status));
      if (!saved) notFound('That suggestion does not exist.');
      return saved;
    },
  });
}
