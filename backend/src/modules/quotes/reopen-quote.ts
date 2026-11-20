/**
 * reopenQuote (MARKETPLACE §2.5, §5.4; docs/PLATFORM.md §9.2.10): "Request changes" on an open offer or "Get a
 * fresh quote" on one that ran out moves the quote back to `in_review`. The customer's message goes into their
 * support thread with the quote as context (locks: quotes → support_threads, through the support module).
 */
import { canQuoteTransition, type OkResponse, type ReopenQuoteRequest } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, notFound, permissionDenied } from '../../platform/http/errors';
import { newId } from '../../platform/ids';
import { notifyStaff } from '../notifications';
import { postSupportMessage } from '../support';
import { findQuote, lockQuote, saveQuote } from './repository';

export async function reopenQuote(deps: Deps, actor: Actor, req: ReopenQuoteRequest): Promise<OkResponse> {
  const known = await findQuote(deps.pool, req.quoteId);
  if (!known) notFound('That quote does not exist.');
  if (known.customerId !== actor.uid) permissionDenied();
  const messageId = newId();

  await withTransaction(deps, async (tx) => {
    const quote = await lockQuote(tx, req.quoteId);
    if (!quote) notFound('That quote does not exist.');
    if (quote.status === 'in_review') return;
    if (!canQuoteTransition(quote.status, 'in_review', 'customer')) {
      failedPrecondition(`Quote ${quote.number} is ${quote.status.replace('_', ' ')} and can't be reopened.`);
    }
    const saved = await saveQuote(tx, {
      ...quote,
      status: 'in_review',
      statusAt: { ...quote.statusAt, in_review: tx.now },
    });
    if (req.message) {
      // The customer's own thread (id = uid), through the support module's writer (summary, counters, staff).
      await postSupportMessage(tx, {
        threadId: saved.customerId,
        id: messageId,
        text: req.message.slice(0, 1000),
        context: { kind: 'quote', id: saved.id, label: `Quote ${saved.number}` },
        sender: { uid: actor.uid, name: actor.name, role: 'customer' },
      });
    }
    await notifyStaff(tx, {
      type: 'quote_new',
      title: `Quote ${saved.number} reopened`,
      body: req.message
        ? `${saved.customerName}: ${req.message}`
        : `${saved.customerName} asked for a ${quote.status === 'expired' ? 'fresh quote' : 'change'}.`,
      data: { quoteId: saved.id },
      key: `quote-reopened-${saved.id}-${tx.now}`,
    });
  });
  return { ok: true };
}
