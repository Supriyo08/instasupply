import { api } from './api';

/**
 * A UUIDv4 for `checkoutId`, `requestId`, `issueId` and message ids (MARKETPLACE §7.2). Create it
 * once per attempt and keep it in screen state across retries, so a retry after a lost answer
 * returns the same order instead of placing a second one.
 */
export const newRequestId = (): string => api.newRequestId();
