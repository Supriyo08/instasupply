import { toApiError } from '@instasupply/api-client';

import { describeError } from '@/lib/api';

/** Sign-in and password errors in the console's words (CLIENTS §2.4, last two rows). */
export function authErrorMessage(error: unknown): string {
  const e = toApiError(error);
  if (e.status === 'resource-exhausted') {
    const retryAfterMs = e.details.retryAfterMs;
    const minutes = typeof retryAfterMs === 'number' ? Math.max(1, Math.ceil(retryAfterMs / 60_000)) : null;
    return minutes
      ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      : 'Too many attempts. Wait a moment and try again.';
  }
  if (e.status === 'permission-denied' && e.authReason === 'account_suspended') {
    return 'Your account is not active. Ask an administrator to restore access.';
  }
  return describeError(e);
}
