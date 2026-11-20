/**
 * submitMaterialList (docs/PLATFORM.md §9.2.10; MARKETPLACE §5.5.6): a customer's material list becomes
 * `quotes/{requestId}`, status `submitted`, with the answer promised by `respondBy` (§4.6). The request id is the
 * quote id, so a retry answers the same quote (D17). Attachments are checked against their `files` rows before
 * the transaction; their name, type and size come from those rows.
 */
import {
  quoteRespondBy,
  validateMaterialList,
  type JobsiteSnapshot,
  type Quote,
  type QuoteAttachment,
  type SubmitMaterialListRequest,
  type SubmitMaterialListResponse,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { nextNumber } from '../../platform/db/sequences';
import { withTransaction } from '../../platform/db/tx';
import { ApiError, failCode, invalidArgument, notFound } from '../../platform/http/errors';
import { requireReadyFile } from '../../platform/storage/files.service';
import { notifyStaff } from '../notifications';
import { findQuote, insertQuote, readJobsiteSnapshot, readQuoteCustomer } from './repository';

const answerOf = (quote: Quote): SubmitMaterialListResponse => ({
  quoteId: quote.id,
  number: quote.number,
  respondBy: quote.respondBy,
});

function existingAnswer(quote: Quote | null, uid: string): SubmitMaterialListResponse | null {
  if (!quote) return null;
  if (quote.customerId !== uid) throw new ApiError('already-exists', 'That request id is already in use.');
  return answerOf(quote);
}

/** A shared ValidationResult failure as `invalid-argument` with `details.fields` (§4.2). */
export function refuseFields(errors: Record<string, string | undefined>): never {
  const fields = Object.fromEntries(
    Object.entries(errors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const first = Object.values(fields)[0] ?? 'Check the form and try again.';
  return invalidArgument(first, { fields });
}

export async function submitMaterialList(
  deps: Deps,
  actor: Actor,
  req: SubmitMaterialListRequest,
): Promise<SubmitMaterialListResponse> {
  const answered = existingAnswer(await findQuote(deps.pool, req.requestId), actor.uid);
  if (answered) return answered;

  const { requestId, ...form } = req;
  const checked = validateMaterialList(form, { uid: actor.uid, requestId });
  if (!checked.ok) refuseFields(checked.errors);
  const input = checked.value;

  const customer = await readQuoteCustomer(deps.pool, actor.uid);
  if (!customer) notFound('Your account was not found.');
  // Staff call or message the number the customer gave; it must be the verified one when phones are verified.
  if (
    input.contact.preferred !== 'email' &&
    deps.config.PHONE_VERIFICATION === 'required' &&
    !customer.phoneVerified
  ) {
    failCode('PHONE_UNVERIFIED', 'Verify your phone number before you send a list.');
  }

  const attachments: QuoteAttachment[] = [];
  for (const given of input.attachments) {
    const file = await requireReadyFile(deps.pool, given.path, {
      purpose: 'quote_upload',
      scopeId: requestId,
      uploadedBy: actor.uid,
    });
    attachments.push({
      path: file.path,
      name: file.original_name ?? given.name,
      contentType: file.content_type,
      sizeBytes: file.size_bytes ?? given.sizeBytes,
    });
  }

  let jobsite: JobsiteSnapshot | null = null;
  if (input.jobsiteId !== null) {
    jobsite = await readJobsiteSnapshot(deps.pool, input.jobsiteId, actor.uid);
    if (!jobsite) notFound('That jobsite no longer exists. Choose another one.');
  }

  const quote = await withTransaction(deps, async (tx) => {
    const now = tx.now;
    const number = `Q-${await nextNumber(tx, 'quote')}`;
    const draft: Quote = {
      id: requestId,
      number,
      customerId: customer.id,
      customerName: customer.displayName,
      companyName: customer.companyName,
      customerPhone: input.contact.phone ?? customer.phoneNumber,
      customerEmail: input.contact.email ?? customer.email,
      request: {
        lines: input.lines,
        attachments,
        neededBy: input.neededBy,
        fulfilment: input.fulfilment,
        jobsite,
        contact: input.contact,
        notes: input.notes,
      },
      status: 'submitted',
      statusAt: { submitted: now },
      respondBy: quoteRespondBy(now),
      assignedTo: null,
      assignedName: null,
      offer: null,
      offerValidUntil: null,
      offerHistory: [],
      orderId: null,
      closeReason: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await insertQuote(tx, draft))) {
      // A concurrent retry with the same id committed first: its quote is the answer.
      return findQuote(tx, requestId);
    }
    const items = input.lines.length;
    const files = attachments.length;
    const parts = [
      items > 0 ? `${items} item${items === 1 ? '' : 's'}` : null,
      files > 0 ? `${files} file${files === 1 ? '' : 's'}` : null,
    ];
    await notifyStaff(tx, {
      type: 'quote_new',
      title: `New material list ${number}`,
      body: `${customer.displayName} · ${parts.filter((part) => part !== null).join(' · ')} · ${input.fulfilment}`,
      data: { quoteId: requestId },
      key: `quote-new-${requestId}`,
    });
    return draft;
  });
  const answer = existingAnswer(quote, actor.uid);
  if (!answer) throw new ApiError('internal', 'The material list could not be saved.');
  return answer;
}
