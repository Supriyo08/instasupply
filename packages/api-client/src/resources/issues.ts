import type { Issue } from '@instasupply/shared';

import type { AssignPatch, IssueNotes } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

export const issuePaths = {
  issues: '/issues',
  issue: (issueId: string) => `/issues/${seg(issueId)}`,
  notes: (issueId: string) => `/issues/${seg(issueId)}/notes`,
} as const;

export function createIssues(ctx: ResourceContext) {
  return {
    /** Staff: assignee and `in_review` only. */
    update: (issueId: string, patch: AssignPatch) =>
      writeThen(ctx, [['issue', issueId], ['issues']], () => ctx.rest.patch<Issue>(issuePaths.issue(issueId), patch)),
    saveNotes: (issueId: string, notes: string) =>
      writeThen(ctx, [['issue-notes', issueId]], () =>
        ctx.rest.put<IssueNotes>(issuePaths.notes(issueId), { notes }),
      ),
  };
}
