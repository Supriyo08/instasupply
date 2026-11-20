/**
 * closeQuote (MARKETPLACE §2.5, §5.4; docs/PLATFORM.md §9.2.10): the customer who owns the quote declines it
 * (submitted, in review or quoted); staff cancel it (submitted or in review, "can't source it"). A quote that
 * is already where the call would move it answers OkResponse.
 */
import {
  canQuoteTransition,
  type CloseQuoteRequest,
  type OkResponse,
  type QuoteStatus,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, notFound, permissionDenied } from '../../platform/http/errors';
import { notify } from '../notifications';
import { findQuote, lockQuote, saveQuote } from './repository';

export async function closeQuote(deps: Deps, actor: Actor, req: CloseQuoteRequest): Promise<OkResponse> {
  const known = await findQuote(deps.pool, req.quoteId);
  if (!known) notFound('That quote does not exist.');
  const byStaff = actor.isStaff;
  if (!byStaff && (actor.role !== 'customer' || !actor.isActive || known.customerId !== actor.uid)) {
    permissionDenied();
  }
  const target: QuoteStatus = byStaff ? 'cancelled' : 'declined';

  await withTransaction(deps, async (tx) => {
    const quote = await lockQuote(tx, req.quoteId);
    if (!quote) notFound('That quote does not exist.');
    if (quote.status === target) return;
    if (!canQuoteTransition(quote.status, target, byStaff ? 'staff' : 'customer')) {
      failedPrecondition(
        byStaff && quote.status === 'quoted'
          ? `Quote ${quote.number} has an open offer; only the customer or its expiry can end it.`
          : `Quote ${quote.number} is ${quote.status.replace('_', ' ')} and can't be closed.`,
      );
    }
    const saved = await saveQuote(tx, {
      ...quote,
      status: target,
      statusAt: { ...quote.statusAt, [target]: tx.now },
      closeReason: req.reason ?? null,
    });
    if (byStaff) {
      await notify(tx, saved.customerId, {
        type: 'quote_update',
        title: `Quote ${saved.number} closed`,
        body: req.reason
          ? `We couldn't quote ${saved.number}: ${req.reason}`
          : `We couldn't quote ${saved.number}. Contact support for help.`,
        data: { quoteId: saved.id },
        key: `quote-closed-${saved.id}`,
      });
    }
  });
  return { ok: true };
}
