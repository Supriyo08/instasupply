/**
 * Thin wrappers around the Functions v2 builders so every function shares the same region,
 * secrets, scaling limits and error handling.
 */
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';

import { enforceAppCheck, managedSecrets, minInstances, region } from '../config/runtime';

export const baseOptions = {
  region,
  secrets: managedSecrets,
  maxInstances: 20,
  memory: '256MiB' as const,
  timeoutSeconds: 60,
};

const callableOptions: CallableOptions = {
  ...baseOptions,
  enforceAppCheck,
  minInstances,
};

/** Define a callable with consistent options; unexpected errors are logged and sanitized. */
export function callable<Request, Response>(
  name: string,
  handler: (request: CallableRequest<Request>) => Promise<Response>,
  options: Partial<CallableOptions> = {},
) {
  return onCall<Request, Promise<Response>>({ ...callableOptions, ...options }, async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`${name} failed`, {
        uid: request.auth?.uid,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      throw new HttpsError('internal', 'Something went wrong on our side. Please try again.');
    }
  });
}

/** Run side effects concurrently; log failures instead of failing the whole trigger. */
export async function settleAll(label: string, tasks: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason = result.reason as unknown;
      logger.error(`${label}: side effect failed`, {
        error: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
      });
    }
  }
}
