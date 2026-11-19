import {
  isErrorCode,
  type AuthFailureReason,
  type ErrorCode,
  type ErrorDetailsByCode as SharedErrorDetailsByCode,
} from '@instasupply/shared';

/** Statuses the server sends (MARKETPLACE §5.9, PLATFORM §4.2). `unavailable` also comes from the server (503). */
export type ServerErrorStatus =
  | 'invalid-argument'
  | 'failed-precondition'
  | 'permission-denied'
  | 'unauthenticated'
  | 'not-found'
  | 'already-exists'
  | 'resource-exhausted'
  | 'internal'
  | 'unavailable';

/** Statuses the client produces itself when no usable answer arrived. */
export type TransportErrorStatus = 'unavailable' | 'deadline-exceeded' | 'cancelled';

export type ApiErrorStatus = ServerErrorStatus | TransportErrorStatus;

/** Why an `unauthenticated` or `permission-denied` answer ended, or did not end, the session (PLATFORM §6.4). */
export type { AuthFailureReason };

const AUTH_REASONS: readonly AuthFailureReason[] = [
  'token_expired',
  'token_invalid',
  'session_revoked',
  'refresh_reused',
  'account_suspended',
  'credentials',
];

const STATUSES: readonly ApiErrorStatus[] = [
  'invalid-argument',
  'failed-precondition',
  'permission-denied',
  'unauthenticated',
  'not-found',
  'already-exists',
  'resource-exhausted',
  'internal',
  'unavailable',
  'deadline-exceeded',
  'cancelled',
];

export interface ApiErrorInit {
  status: ApiErrorStatus;
  code?: ErrorCode | null;
  message: string;
  details?: Record<string, unknown>;
  httpStatus?: number | null;
  requestId?: string | null;
  method?: string;
  path?: string;
  cause?: unknown;
  /**
   * False when `message` is technical (a response that was not our envelope, a local check) and must not
   * be shown to the user. Defaults to true when `httpStatus` is set.
   */
  fromServer?: boolean;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: ApiErrorStatus;
  /** The business code of MARKETPLACE §5.9 when there is one. Screens react to this, never to `message`. */
  readonly code: ErrorCode | null;
  readonly details: Readonly<Record<string, unknown>>;
  /** Null when no HTTP response arrived. */
  readonly httpStatus: number | null;
  /** Value of the `x-request-id` response header, for support tickets and logs. */
  readonly requestId: string | null;
  readonly method: string;
  /** Path below /api/v1, without the query string. */
  readonly path: string;
  /** True when `message` was written by the server for the user (see `ApiErrorInit.fromServer`). */
  readonly fromServer: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code ?? null;
    this.details = init.details ?? {};
    this.httpStatus = init.httpStatus ?? null;
    this.requestId = init.requestId ?? null;
    this.method = init.method ?? '';
    this.path = init.path ?? '';
    this.fromServer = init.fromServer ?? this.httpStatus !== null;
  }

  /** No answer, a timeout, or a gateway error (502, 503, 504): the same request may work later. */
  get retryable(): boolean {
    if (this.status === 'unavailable' || this.status === 'deadline-exceeded') return true;
    return this.httpStatus === 502 || this.httpStatus === 503 || this.httpStatus === 504;
  }

  /** `unavailable` or `deadline-exceeded`: the device is offline or the server cannot be reached. */
  get isNetwork(): boolean {
    return this.status === 'unavailable' || this.status === 'deadline-exceeded';
  }

  /** `details.reason` when the server sent one of the auth reasons. */
  get authReason(): AuthFailureReason | null {
    const reason = this.details.reason;
    return typeof reason === 'string' && (AUTH_REASONS as readonly string[]).includes(reason)
      ? (reason as AuthFailureReason)
      : null;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isAbortError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'AbortError';
}

/** Wraps anything thrown (TypeError from fetch, AbortError, a string) into an ApiError. Never throws. */
export function toApiError(value: unknown): ApiError {
  if (value instanceof ApiError) return value;
  if (isAbortError(value)) {
    return new ApiError({ status: 'cancelled', message: 'The request was cancelled.', cause: value });
  }
  if (value instanceof TypeError) {
    // fetch rejects with a TypeError when no response arrived (DNS, refused, offline, CORS).
    return new ApiError({ status: 'unavailable', message: value.message || 'Network error', cause: value });
  }
  const message =
    value instanceof Error ? value.message : typeof value === 'string' ? value : 'Unknown error';
  return new ApiError({ status: 'internal', message, cause: value });
}

/** The MARKETPLACE §5.9 code of any thrown value, or null. `errorCodeOf(e) === ERROR_CODES.PRICE_CHANGED`. */
export function errorCodeOf(error: unknown): ErrorCode | null {
  return error instanceof ApiError ? error.code : null;
}

export function errorStatusOf(error: unknown): ApiErrorStatus | null {
  return error instanceof ApiError ? error.status : null;
}

/** True for `unavailable` and `deadline-exceeded`. Keeps a typed OTP on screen, shows "You're offline". */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.isNetwork;
}

/** The `details` each code carries; one definition shared with the server (`@instasupply/shared` errors.ts). */
export type ErrorDetailsByCode = SharedErrorDetailsByCode;

/** Typed details when `error` carries `code`, else null: `detailsFor(e, 'OUT_OF_STOCK')?.available`. */
export function detailsFor<C extends keyof ErrorDetailsByCode>(
  error: unknown,
  code: C,
): ErrorDetailsByCode[C] | null {
  if (!(error instanceof ApiError) || error.code !== code) return null;
  // The server builds these objects from the same shared type; the client cannot check more than the code.
  return error.details as unknown as ErrorDetailsByCode[C];
}

const DEFAULT_FALLBACK = 'Something went wrong. Please try again.';

/**
 * A sentence for the user. Server messages are written for users, so they are shown for
 * invalid-argument, failed-precondition, already-exists, not-found, permission-denied and
 * resource-exhausted. `internal`, transport errors and `unauthenticated` get our own wording.
 */
export function describeError(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  const e = toApiError(error);
  // A non-envelope answer (proxy page) has no user-facing message; `fromServer` tells them apart.
  const serverMessage = e.fromServer ? e.message.trim() : '';
  switch (e.status) {
    case 'unavailable':
      return "Can't reach the server. Check your connection and try again.";
    case 'deadline-exceeded':
      return 'This is taking longer than usual. Check your connection and try again.';
    case 'cancelled':
      return 'The request was interrupted. Please try again.';
    case 'unauthenticated':
      return e.authReason === 'credentials'
        ? 'That email and password combination is incorrect.'
        : 'Your session has ended. Please sign in again.';
    case 'permission-denied':
      if (e.authReason === 'account_suspended')
        return 'Your account is suspended. Contact InstaSupply support.';
      return serverMessage || "You don't have access to this.";
    case 'resource-exhausted':
      return serverMessage || 'Too many requests right now. Please wait a moment and try again.';
    case 'not-found':
      return serverMessage || "That isn't available right now. Please try again later.";
    case 'invalid-argument':
    case 'failed-precondition':
    case 'already-exists':
      return serverMessage || fallback;
    default:
      return fallback;
  }
}

/** Status for an HTTP code when the body is not our envelope (CLIENTS §1.3). */
export function statusForHttp(httpStatus: number): ApiErrorStatus {
  if (httpStatus === 400 || httpStatus === 413 || httpStatus === 415 || httpStatus === 422) {
    return 'invalid-argument';
  }
  if (httpStatus === 401) return 'unauthenticated';
  if (httpStatus === 403) return 'permission-denied';
  if (httpStatus === 404) return 'not-found';
  if (httpStatus === 409) return 'already-exists';
  if (httpStatus === 412) return 'failed-precondition';
  if (httpStatus === 429) return 'resource-exhausted';
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return 'unavailable';
  return 'internal';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the ApiError of a failed HTTP response. With the envelope, `error.status` in the body is the
 * truth and the HTTP code is only recorded; `code` comes from `error.code`, then `error.details.code`.
 */
export function errorFromResponse(input: {
  httpStatus: number;
  body: unknown;
  requestId: string | null;
  method: string;
  path: string;
}): ApiError {
  const envelope = isRecord(input.body) && isRecord(input.body.error) ? input.body.error : null;
  const bodyStatus = envelope?.status;
  if (envelope && typeof bodyStatus === 'string' && (STATUSES as readonly string[]).includes(bodyStatus)) {
    const details = isRecord(envelope.details) ? envelope.details : {};
    const code = isErrorCode(envelope.code) ? envelope.code : isErrorCode(details.code) ? details.code : null;
    const message = typeof envelope.message === 'string' ? envelope.message : '';
    return new ApiError({
      status: bodyStatus as ApiErrorStatus,
      code,
      message,
      details,
      httpStatus: input.httpStatus,
      requestId: input.requestId,
      method: input.method,
      path: input.path,
    });
  }
  return new ApiError({
    status: statusForHttp(input.httpStatus),
    message: `HTTP ${input.httpStatus}`,
    fromServer: false,
    httpStatus: input.httpStatus,
    requestId: input.requestId,
    method: input.method,
    path: input.path,
  });
}
