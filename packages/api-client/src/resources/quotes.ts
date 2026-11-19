import type { Quote } from '@instasupply/shared';

import type { AssignPatch } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

export const quotePaths = {
  quotes: '/quotes',
  quote: (quoteId: string) => `/quotes/${seg(quoteId)}`,
  workspace: (quoteId: string) => `/quotes/${seg(quoteId)}/workspace`,
} as const;

export function createQuotes(ctx: ResourceContext) {
  return {
    /** Staff: assignee and `in_review` only. */
    update: (quoteId: string, patch: AssignPatch) =>
      writeThen(ctx, [['quote', quoteId], ['quotes']], () => ctx.rest.patch<Quote>(quotePaths.quote(quoteId), patch)),
    /** The builder holds the draft, so nothing is invalidated. */
    saveWorkspace: <T extends Record<string, unknown>>(quoteId: string, draft: T) =>
      ctx.rest.put<T>(quotePaths.workspace(quoteId), draft),
  };
}
