import { queries } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import type {
  AcceptQuoteRequest,
  CloseQuoteRequest,
  ReopenQuoteRequest,
  SubmitMaterialListRequest,
} from '@instasupply/shared';

import { call } from '@/lib/callables';

/** The customer's material lists and quotes, newest first, paged and live. */
export function useCustomerQuotes(uid: string | null | undefined) {
  return usePagedQuery(queries.customerQuotes(uid));
}

/** One quote, live; null when it does not exist. */
export function useQuote(quoteId: string | null | undefined) {
  return useLiveQuery(queries.quote(quoteId));
}

/** Upload attachments first (`purpose: 'quote_upload'`, `ownerId: requestId`), then send their paths. */
export function submitMaterialList(request: SubmitMaterialListRequest) {
  return call('submitMaterialList', request);
}

/** `checkoutId` from `newRequestId()`, once per screen and kept across retries, as for `placeOrder`. */
export function acceptQuote(request: AcceptQuoteRequest) {
  return call('acceptQuote', request);
}

export function closeQuote(request: CloseQuoteRequest) {
  return call('closeQuote', request);
}

export function reopenQuote(request: ReopenQuoteRequest) {
  return call('reopenQuote', request);
}
