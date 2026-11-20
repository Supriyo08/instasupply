/**
 * The issue commands and REST endpoints (docs/PLATFORM.md §5.2, §5.3.7): reportIssue, resolveIssue, GET /issues,
 * GET and PATCH /issues/{id}, the private notes.
 */
import type {
  AssignPatch,
  Issue,
  IssueNotes,
  Page,
  ReportIssueRequest,
  ReportIssueResponse,
  ResolveIssueRequest,
  ResolveIssueResponse,
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
import { getNotes, patchIssue, putNotes } from './issue-admin';
import { reportIssue } from './report-issue';
import { findIssue, listIssues } from './repository';
import { resolveIssue } from './resolve-issue';
import {
  AssignPatchSchema,
  IssuesQuerySchema,
  NotesBodySchema,
  ReportIssueRequestSchema,
  ResolveIssueRequestSchema,
  type IssuesQuery,
} from './schemas';

const isMemberOf = (actor: Actor, storeId: string): boolean =>
  actor.role === 'supplier' && actor.isActive && actor.storeId !== null && actor.storeId === storeId;

/** canReadIssue of §7.3: staff, the customer who owns it, an active member of its store. */
export const canReadIssue = (actor: Actor, issue: Pick<Issue, 'customerId' | 'storeId'>): boolean =>
  actor.isStaff ||
  (actor.role === 'customer' && actor.isActive && issue.customerId === actor.uid) ||
  isMemberOf(actor, issue.storeId);

/** A customer, an active supplier, or staff; the row check follows. */
function requireIssueReader(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.isStaff) return actor;
  if (actor.isActive && (actor.role === 'customer' || (actor.role === 'supplier' && actor.storeId)))
    return actor;
  return permissionDenied();
}

export function registerIssueCommands(): void {
  defineCommand<ReportIssueRequest, ReportIssueResponse>({
    name: 'reportIssue',
    policy: requireCustomer,
    schema: ReportIssueRequestSchema,
    limits: (ctx) => [use('issue_report', ctx.actor!.uid)],
    handler: (ctx, req, actor) => reportIssue(ctx.deps, actor!, req),
  });
  defineCommand<ResolveIssueRequest, ResolveIssueResponse>({
    name: 'resolveIssue',
    policy: requireStaff,
    schema: ResolveIssueRequestSchema,
    handler: (ctx, req, actor) => resolveIssue(ctx.deps, actor!, req),
  });
}

const issueParams = z.object({ issueId: idParam });

export function registerIssueRoutes(app: FastifyInstance): void {
  defineRoute<Record<string, never>, IssuesQuery, undefined, Page<Issue>>(app, {
    method: 'GET',
    url: '/issues',
    policy: requireIssueReader,
    query: IssuesQuerySchema,
    handler: async (ctx, { query }, actor) => {
      const me = actor!;
      let { customerId, storeId } = query;
      if (!me.isStaff) {
        // The scoping rule of §5.3: customers get their own rows, suppliers their store's.
        if (me.role === 'customer') {
          if (customerId !== undefined && customerId !== me.uid) permissionDenied();
          if (storeId !== undefined) permissionDenied();
          customerId = me.uid;
        } else {
          if (storeId !== undefined && storeId !== me.storeId) permissionDenied();
          if (customerId !== undefined) permissionDenied();
          storeId = me.storeId!;
        }
      }
      let after: { createdAt: number; id: string } | null = null;
      if (query.cursor) {
        const [value, id] = decodeCursor(query.cursor);
        if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
        after = { createdAt: value, id };
      }
      const rows = await listIssues(ctx.deps.pool, {
        customerId,
        storeId,
        orderId: query.orderId,
        storeOrderId: query.storeOrderId,
        statuses: query.status,
        limit: query.limit,
        after,
      });
      return readPage(
        rows,
        query.limit,
        (issue) => issue,
        (issue) => [issue.createdAt, issue.id],
      );
    },
  });

  defineRoute<{ issueId: string }, Record<string, never>, undefined, Issue>(app, {
    method: 'GET',
    url: '/issues/:issueId',
    policy: requireIssueReader,
    params: issueParams,
    handler: async (ctx, { params }, actor) => {
      const issue = await findIssue(ctx.deps.pool, params.issueId);
      if (!issue) notFound('That case does not exist.');
      if (!canReadIssue(actor!, issue)) permissionDenied();
      return issue;
    },
  });

  defineRoute<{ issueId: string }, Record<string, never>, AssignPatch, Issue>(app, {
    method: 'PATCH',
    url: '/issues/:issueId',
    policy: requireStaff,
    params: issueParams,
    body: AssignPatchSchema,
    handler: (ctx, { params, body }) => patchIssue(ctx.deps, params.issueId, body),
  });

  defineRoute<{ issueId: string }, Record<string, never>, undefined, IssueNotes>(app, {
    method: 'GET',
    url: '/issues/:issueId/notes',
    policy: requireStaff,
    params: issueParams,
    handler: (ctx, { params }) => getNotes(ctx.deps, params.issueId),
  });

  defineRoute<{ issueId: string }, Record<string, never>, { notes: string }, IssueNotes>(app, {
    method: 'PUT',
    url: '/issues/:issueId/notes',
    policy: requireStaff,
    params: issueParams,
    body: NotesBodySchema,
    handler: (ctx, { params, body }, actor) => putNotes(ctx.deps, actor!, params.issueId, body.notes),
  });
}
