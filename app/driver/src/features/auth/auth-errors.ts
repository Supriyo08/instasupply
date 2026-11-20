import { describeError, errorStatusOf, isApiError } from '@/lib/api';

/**
 * The sentence for a failed sign-in, sign-up or reset (CLIENTS §2.4). A rate limit says how long to
 * wait, from `details.retryAfterMs`; everything else is `describeError`.
 */
export function authErrorMessage(error: unknown): string {
  if (errorStatusOf(error) === 'resource-exhausted' && isApiError(error)) {
    const retryAfterMs = error.details.retryAfterMs;
    if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
      const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
      return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
    }
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  return describeError(error);
}
