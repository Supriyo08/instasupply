import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

// These are function declarations (not arrow consts) so TypeScript narrows after calling them.

/** Throw a client-visible error. The message is shown to users, so keep it human. */
export function fail(code: FunctionsErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new HttpsError(code, message, details);
}

export function invalidArgument(message: string, details?: Record<string, unknown>): never {
  fail('invalid-argument', message, details);
}

export function notFound(message: string): never {
  fail('not-found', message);
}

export function permissionDenied(message = "You don't have permission to do that."): never {
  fail('permission-denied', message);
}

export function failedPrecondition(message: string): never {
  fail('failed-precondition', message);
}

/** Firebase Admin errors carry a string `code` such as `auth/user-not-found`. */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : '';
  }
  return '';
}
