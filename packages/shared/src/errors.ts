/**
 * Error codes of the callable functions (§5.9). A callable that fails for a business reason sends one
 * of these as `details.code`, and the apps react to the code, never to the message text: show the new
 * total, reopen the window picker, clamp a cart line, and so on.
 */
import type { WindowOption } from './fulfilment-time';
import type { PricedCheckout, PricingErrorCode } from './pricing';

/** The HttpsError status a code travels with (§5.9, column "HttpsError"). */
export type ErrorCodeStatus = 'failed-precondition' | 'invalid-argument' | 'resource-exhausted';

/** The table of §5.9, in its order: every code, written once, with its status. */
const STATUS_BY_CODE = {
  PRICE_CHANGED: 'failed-precondition',
  WINDOW_UNAVAILABLE: 'failed-precondition',
  OUT_OF_STOCK: 'failed-precondition',
  STORE_UNAVAILABLE: 'failed-precondition',
  STORE_PAUSED: 'failed-precondition',
  OUT_OF_RANGE: 'failed-precondition',
  TOO_LARGE: 'failed-precondition',
  JOBSITE_VEHICLE_LIMIT: 'failed-precondition',
  EMPTY: 'failed-precondition',
  TOO_MANY_STORES: 'failed-precondition',
  NO_DROPOFF: 'failed-precondition',
  DELIVERY_UNAVAILABLE: 'failed-precondition',
  PICKUP_UNAVAILABLE: 'failed-precondition',
  OUTSIDE_SERVICE_AREA: 'failed-precondition',
  PHONE_UNVERIFIED: 'failed-precondition',
  PAYMENTS_DISABLED: 'failed-precondition',
  CARD_DECLINED: 'failed-precondition',
  VERSION_CONFLICT: 'failed-precondition',
  STORE_NOT_READY: 'failed-precondition',
  DRIVER_NOT_ASSIGNED: 'failed-precondition',
  CODE_INCORRECT: 'invalid-argument',
  CODE_LOCKED: 'resource-exhausted',
  RATE_LIMITED: 'resource-exhausted',
  TOO_MANY_JOBS: 'resource-exhausted',
  PHOTO_REQUIRED: 'invalid-argument',
  OFFER_TAKEN: 'failed-precondition',
  VEHICLE_TOO_SMALL: 'failed-precondition',
  DRIVER_OFFLINE: 'failed-precondition',
  RELEASED_RECENTLY: 'failed-precondition',
  QUOTE_EXPIRED: 'failed-precondition',
  QUOTE_VERSION: 'failed-precondition',
  ISSUE_WINDOW_CLOSED: 'failed-precondition',
  ISSUE_ALREADY_OPEN: 'failed-precondition',
  REFUND_LIMIT: 'failed-precondition',
} as const satisfies Record<string, ErrorCodeStatus>;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

/** Every code under its own name: call sites read `ERROR_CODES.PRICE_CHANGED`, and a typo cannot compile. */
export const ERROR_CODES = Object.fromEntries(Object.keys(STATUS_BY_CODE).map((code) => [code, code])) as {
  readonly [Code in ErrorCode]: Code;
};

/** Which HttpsError status the server throws each code with. */
export const ERROR_CODE_STATUS: Readonly<Record<ErrorCode, ErrorCodeStatus>> = STATUS_BY_CODE;

/** True for a value that is one of our codes; `details.code` arrives untyped on the client. */
export function isErrorCode(value: unknown): value is ErrorCode {
  // `hasOwnProperty.call` rather than `Object.hasOwn`: it exists on every runtime the apps ship to.
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, value);
}

/** Why the payment gateway refused a card (§3.8). */
export type CardDeclineReason = 'card_declined' | 'insufficient_funds' | 'expired_card' | 'processing_error';

/**
 * The pricing blockers that are about one store (§3.4 step 2). Thrown upper-cased, each one names that
 * store. The three that are about the whole cart (`empty`, `too_many_stores`, `no_dropoff`) send nothing.
 */
type StoreBlockerCode = Uppercase<Exclude<PricingErrorCode, 'empty' | 'too_many_stores' | 'no_dropoff'>>;
type StoreBlockerDetails = { [Code in StoreBlockerCode]: { storeId: string } };

/**
 * What travels in `details` next to `code` (§5.9, column "Details"). A code that is not listed here
 * sends nothing more. The server builds these objects and the apps read them, so both sides use this
 * one definition.
 */
export interface ErrorDetailsByCode extends StoreBlockerDetails {
  /** The server's pricing, so the app can show the new total and ask again. */
  PRICE_CHANGED: { pricing: PricedCheckout };
  /**
   * Fresh windows for the picker: the ASAP option first, then every slot (§4.7). They are
   * `WindowOption`s, plain numbers and strings; a stored `DeliveryWindow` holds timestamps and cannot
   * travel in an error.
   */
  WINDOW_UNAVAILABLE: { windows: WindowOption[] };
  /** The app clamps the cart line to `available`. */
  OUT_OF_STOCK: { productId: string; available: number };
  CARD_DECLINED: { reason: CardDeclineReason };
  /** The store order's current version: reload and try again. */
  VERSION_CONFLICT: { version: number };
  /** Attempts left before the PIN or hand-off code locks. */
  CODE_INCORRECT: { remaining: number };
}

/** `ErrorDetailsOf<'OUT_OF_STOCK'>` is `{ productId; available }`; a code without details gives an empty object. */
export type ErrorDetailsOf<Code extends ErrorCode> = Code extends keyof ErrorDetailsByCode
  ? ErrorDetailsByCode[Code]
  : Record<string, never>;

// §5.9: every pricing blocker is thrown upper-cased, so each `PricingErrorCode` needs its code here.
// When one is missing, the second line stops compiling.
type AssertTrue<T extends true> = T;
type _EveryPricingErrorHasACode = AssertTrue<Uppercase<PricingErrorCode> extends ErrorCode ? true : false>;
// Details can only be declared for a code that exists.
type _DetailsAreForKnownCodes = AssertTrue<keyof ErrorDetailsByCode extends ErrorCode ? true : false>;
