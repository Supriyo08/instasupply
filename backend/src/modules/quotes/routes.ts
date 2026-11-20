/**
 * The quote commands and REST endpoints (docs/PLATFORM.md §5.2, §5.3.7): submitMaterialList, sendQuote,
 * acceptQuote, closeQuote, reopenQuote, GET /quotes, GET and PATCH /quotes/{id}, the workspace.
 */
import type {
  AcceptQuoteRequest,
  AssignPatch,
  CloseQuoteRequest,
  OkResponse,
  Page,
  PlaceOrderResponse,
  Quote,
  ReopenQuoteRequest,
  SendQuoteRequest,
  SubmitMaterialListRequest,
  SubmitMaterialListResponse,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../../platform/auth/actor';
import { requireAuth, requireCustomer, requireStaff } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import type { RequestContext } from '../../platform/http/context';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, readPage } from '../../platform/http/pagination';
import { use } from '../../platform/http/rate-limit';
import { defineRoute, idParam } from '../../platform/http/route';
import { acceptQuote } from './accept-quote';
import { closeQuote } from './close-quote';
import { getWorkspace, patchQuote, putWorkspace } from './quote-admin';
import { reopenQuote } from './reopen-quote';
import { findQuote, listQuotes } from './repository';
import {
  AcceptQuoteRequestSchema,
  AssignPatchSchema,
  CloseQuoteRequestSchema,
  QuotesQuerySchema,
  ReopenQuoteRequestSchema,
  SendQuoteRequestSchema,
  SubmitMaterialListRequestSchema,
  WORKSPACE_MAX_BYTES,
  WorkspaceSchema,
  type QuotesQuery,
} from './schemas';
import { sendQuote } from './send-quote';
import { submitMaterialList } from './submit-material-list';

/** A customer (own quotes) or staff. */
function requireQuoteReader(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.isStaff) return actor;
  return requireCustomer(ctx);
}

export function registerQuoteCommands(): void {
  defineCommand<SubmitMaterialListRequest, SubmitMaterialListResponse>({
    name: 'submitMaterialList',
    policy: requireCustomer,
    schema: SubmitMaterialListRequestSchema,
    limits: (ctx) => [use('material_list', ctx.actor!.uid)],
    handler: (ctx, req, actor) => submitMaterialList(ctx.deps, actor!, req),
  });
  defineCommand<SendQuoteRequest, OkResponse>({
    name: 'sendQuote',
    policy: requireStaff,
    schema: SendQuoteRequestSchema,
    handler: (ctx, req, actor) => sendQuote(ctx.deps, actor!, req),
  });
  defineCommand<AcceptQuoteRequest, PlaceOrderResponse>({
    name: 'acceptQuote',
    policy: requireCustomer,
    schema: AcceptQuoteRequestSchema,
    handler: (ctx, req, actor) => acceptQuote(ctx.deps, actor!, req, ctx.origin),
  });
  defineCommand<CloseQuoteRequest, OkResponse>({
    name: 'closeQuote',
    // The customer who owns it, or staff; the handler checks the owner on the row.
    policy: requireQuoteReader,
    schema: CloseQuoteRequestSchema,
    handler: (ctx, req, actor) => closeQuote(ctx.deps, actor!, req),
  });
  defineCommand<ReopenQuoteRequest, OkResponse>({
    name: 'reopenQuote',
    policy: requireCustomer,
    schema: ReopenQuoteRequestSchema,
    handler: (ctx, req, actor) => reopenQuote(ctx.deps, actor!, req),
  });
}

const quoteParams = z.object({ quoteId: idParam });

export function registerQuoteRoutes(app: FastifyInstance): void {
  defineRoute<Record<string, never>, QuotesQuery, undefined, Page<Quote>>(app, {
    method: 'GET',
    url: '/quotes',
    policy: requireQuoteReader,
    query: QuotesQuerySchema,
    handler: async (ctx, { query }, actor) => {
      const me = actor!;
      let customerId = query.customerId;
      if (!me.isStaff) {
        // The scoping rule of §5.3: a customer only ever gets their own rows.
        if (customerId !== undefined && customerId !== me.uid) permissionDenied();
        customerId = me.uid;
        if (query.assignedTo !== undefined) {
          invalidArgument('That filter is for staff only.', { fields: { assignedTo: 'staff only' } });
        }
      }
      let after: { value: number; id: string } | null = null;
      if (query.cursor) {
        const [value, id] = decodeCursor(query.cursor);
        if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
        after = { value, id };
      }
      const rows = await listQuotes(ctx.deps.pool, {
        customerId,
        statuses: query.status,
        assignedTo: query.assignedTo,
        sort: query.sort,
        limit: query.limit,
        after,
      });
      return readPage(
        rows,
        query.limit,
        (quote) => quote,
        (quote) => [query.sort === 'respondBy:asc' ? quote.respondBy : quote.createdAt, quote.id],
      );
    },
  });

  defineRoute<{ quoteId: string }, Record<string, never>, undefined, Quote>(app, {
    method: 'GET',
    url: '/quotes/:quoteId',
    policy: requireQuoteReader,
    params: quoteParams,
    handler: async (ctx, { params }, actor) => {
      const quote = await findQuote(ctx.deps.pool, params.quoteId);
      if (!quote) notFound('That quote does not exist.');
      if (!actor!.isStaff && quote.customerId !== actor!.uid) permissionDenied();
      return quote;
    },
  });

  defineRoute<{ quoteId: string }, Record<string, never>, AssignPatch, Quote>(app, {
    method: 'PATCH',
    url: '/quotes/:quoteId',
    policy: requireStaff,
    params: quoteParams,
    body: AssignPatchSchema,
    handler: (ctx, { params, body }) => patchQuote(ctx.deps, params.quoteId, body),
  });

  defineRoute<{ quoteId: string }, Record<string, never>, undefined, Record<string, unknown>>(app, {
    method: 'GET',
    url: '/quotes/:quoteId/workspace',
    policy: requireStaff,
    params: quoteParams,
    handler: (ctx, { params }) => getWorkspace(ctx.deps, params.quoteId),
  });

  defineRoute<{ quoteId: string }, Record<string, never>, Record<string, unknown>, Record<string, unknown>>(
    app,
    {
      method: 'PUT',
      url: '/quotes/:quoteId/workspace',
      policy: requireStaff,
      params: quoteParams,
      body: WorkspaceSchema,
      bodyLimit: WORKSPACE_MAX_BYTES + 1024,
      handler: (ctx, { params, body }) => {
        if (Buffer.byteLength(JSON.stringify(body)) > WORKSPACE_MAX_BYTES) {
          invalidArgument('The draft is larger than 200 KiB.', { fields: { workspace: 'too large' } });
        }
        return putWorkspace(ctx.deps, params.quoteId, body);
      },
    },
  );
}
