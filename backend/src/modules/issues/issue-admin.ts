/**
 * The staff-only writes of docs/PLATFORM.md §5.3.7 for issues: `PATCH /issues/{id}` (the assignee, and the one
 * status step open → in_review of MARKETPLACE §2.6) and the private notes.
 */
import type { AssignPatch, Issue, IssueNotes } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { activeStaffName, lockIssue, readNotes, saveIssue, writeNotes } from './repository';

export async function patchIssue(deps: Deps, issueId: string, patch: AssignPatch): Promise<Issue> {
  let assignee: { assignedTo: string | null; assignedName: string | null } | null = null;
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo === null) assignee = { assignedTo: null, assignedName: null };
    else {
      const name = await activeStaffName(deps.pool, patch.assignedTo);
      if (name === null)
        invalidArgument('Assign it to an active staff member.', { fields: { assignedTo: 'not staff' } });
      assignee = { assignedTo: patch.assignedTo, assignedName: name };
    }
  }
  return withTransaction(deps, async (tx) => {
    const issue = await lockIssue(tx, issueId);
    if (!issue) notFound('That case does not exist.');
    let next: Issue = issue;
    if (assignee) next = { ...next, ...assignee };
    if (patch.status === 'in_review' && issue.status !== 'in_review') {
      if (issue.status !== 'open') failedPrecondition(`${issue.number} is resolved.`);
      next = { ...next, status: 'in_review', statusAt: { ...next.statusAt, in_review: tx.now } };
    }
    if (next === issue) return issue;
    return saveIssue(tx, next);
  });
}

export async function getNotes(deps: Deps, issueId: string): Promise<IssueNotes> {
  const notes = await readNotes(deps.pool, issueId);
  if (notes === null) notFound('There are no notes on this case yet.');
  return notes;
}

export async function putNotes(deps: Deps, actor: Actor, issueId: string, text: string): Promise<IssueNotes> {
  const notes: IssueNotes = { notes: text, updatedAt: deps.clock.now(), updatedBy: actor.uid };
  if (!(await writeNotes(deps.pool, issueId, notes))) notFound('That case does not exist.');
  return notes;
}
