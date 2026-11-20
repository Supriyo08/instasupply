import { queries } from '@instasupply/api-client';
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import type { ReportIssueRequest } from '@instasupply/shared';

import { call } from '@/lib/callables';

/** The customer's issues, newest first, paged and live. Order detail filters them by `orderId`. */
export function useCustomerIssues(uid: string | null | undefined) {
  return usePagedQuery(queries.customerIssues(uid));
}

/** One issue, live; photos load through `useFileUrl(path)`. */
export function useIssue(issueId: string | null | undefined) {
  return useLiveQuery(queries.issue(issueId));
}

/**
 * `issueId` from `newRequestId()` when the screen opens. Upload photos first with
 * `api.upload({ purpose: 'issue_photo', ownerId: issueId, source })`, then send their paths.
 */
export function reportIssue(request: ReportIssueRequest) {
  return call('reportIssue', request);
}
