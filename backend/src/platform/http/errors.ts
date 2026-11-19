/** The one error type the API answers with (docs/PLATFORM.md §4.2). */
import { ERROR_CODE_STATUS, type ApiStatus, type ErrorCode } from '@instasupply/shared';

export const HTTP_STATUS: Record<ApiStatus, number> = {
  'invalid-argument': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'failed-precondition': 412,
  'resource-exhausted': 429,
  internal: 500,
  unavailable: 503,
};

export const INTERNAL_MESSAGE = 'Something went wrong on our side. Please try again.';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: ApiStatus,
    message: string,
    readonly code: ErrorCode | null = null,
    readonly details: Record<string, unknown> = {},
    /** An HTTP status other than the table's (413, 415 keep their own status with invalid-argument). */
    readonly httpStatus: number = HTTP_STATUS[status],
  ) {
    super(message);
  }
}

export function fail(status: ApiStatus, message: string, details?: Record<string, unknown>): never {
  throw new ApiError(status, message, null, details);
}

/** Throws with the status the shared table gives the code, so MARKETPLACE §5.9 has one source. */
export function failCode(code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new ApiError(ERROR_CODE_STATUS[code], message, code, details);
}

export function invalidArgument(message: string, details?: Record<string, unknown>): never {
  throw new ApiError('invalid-argument', message, null, details);
}

export function notFound(message: string): never {
  throw new ApiError('not-found', message);
}

export function permissionDenied(message = "You don't have permission to do that."): never {
  throw new ApiError('permission-denied', message);
}

export function failedPrecondition(message: string, details?: Record<string, unknown>): never {
  throw new ApiError('failed-precondition', message, null, details);
}

/** A wave-2 placeholder (docs/PLATFORM.md §15 rule 1): compiles against the frozen signature, fails when run. */
export function notImplemented(what: string): never {
  throw new ApiError('internal', 'not implemented', null, { notImplemented: what });
}
