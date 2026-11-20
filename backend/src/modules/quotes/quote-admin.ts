/**
 * The staff-only writes of docs/PLATFORM.md §5.3.7 for quotes: `PATCH /quotes/{id}` (the assignee, and the one
 * status step submitted → in_review of MARKETPLACE §2.5) and the private builder workspace.
 */
import type { AssignPatch, Quote } from '@instasupply/shared';
import type { Deps } from '../../container';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { activeStaffName, lockQuote, readWorkspace, saveQuote, writeWorkspace } from './repository';

/** The assignee must be active staff; the name is filled by the server. */
export async function resolveAssignee(
  deps: Deps,
  assignedTo: string | null,
): Promise<{ assignedTo: string | null; assignedName: string | null }> {
  if (assignedTo === null) return { assignedTo: null, assignedName: null };
  const name = await activeStaffName(deps.pool, assignedTo);
  if (name === null)
    invalidArgument('Assign it to an active staff member.', { fields: { assignedTo: 'not staff' } });
  return { assignedTo, assignedName: name };
}

export async function patchQuote(deps: Deps, quoteId: string, patch: AssignPatch): Promise<Quote> {
  const assignee = patch.assignedTo === undefined ? null : await resolveAssignee(deps, patch.assignedTo);
  return withTransaction(deps, async (tx) => {
    const quote = await lockQuote(tx, quoteId);
    if (!quote) notFound('That quote does not exist.');
    let next: Quote = quote;
    if (assignee) next = { ...next, ...assignee };
    if (patch.status === 'in_review' && quote.status !== 'in_review') {
      if (quote.status !== 'submitted') {
        failedPrecondition(
          `Quote ${quote.number} is ${quote.status.replace('_', ' ')}; only a new list can be opened.`,
        );
      }
      next = { ...next, status: 'in_review', statusAt: { ...next.statusAt, in_review: tx.now } };
    }
    if (next === quote) return quote;
    return saveQuote(tx, next);
  });
}

export async function getWorkspace(deps: Deps, quoteId: string): Promise<Record<string, unknown>> {
  const workspace = await readWorkspace(deps.pool, quoteId);
  if (workspace === null) notFound('There is no saved draft for this quote.');
  return workspace;
}

export async function putWorkspace(
  deps: Deps,
  quoteId: string,
  workspace: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!(await writeWorkspace(deps.pool, quoteId, workspace))) notFound('That quote does not exist.');
  return workspace;
}
