/**
 * Validation shared by the forms in the apps and by the callables, so a form never accepts what the
 * server will refuse. Validators take untrusted input, never throw, and return either the cleaned
 * value or one message per field. The numbers they check are the ones in the security rules (§6.3)
 * and in the callable table (§5.4, §5.5).
 *
 * They check what a person typed. Whether an uploaded file exists, an id is free or a phone is
 * verified is the server's job.
 *
 * The value that comes back is the one to save: text is trimmed, a phone is E.164, a postal code is
 * `A1A 1A1`, a choice is spelled the way the contracts spell it. Fields the contract does not know are
 * left out of it.
 *
 * Two validators also take `today`, the Toronto date, for their date rules. That comes from the
 * caller's clock, not from a person: a malformed one is the only thing a validator throws for.
 */
import type {
  CreateStoreRequest,
  DriverVehicleInput,
  ReportIssueRequest,
  StoreProfilePatch,
  SubmitMaterialListRequest,
} from './api';
import {
  CATEGORIES,
  CATEGORY_IDS,
  SELL_UNITS,
  STORE_SPECIALTY_LABELS,
  type CategoryId,
  type DayHours,
  type DimsCm,
  type PostalAddress,
  type Product,
  type ProductBadge,
  type SellUnit,
  type Store,
  type StoreSpecialty,
  type StoreStatus,
  type Weekday,
} from './catalog';
import { PRIORITIES, STORAGE_FOLDERS } from './constants';
import { isValidLatLng } from './geo';
import type { IssueType } from './issues';
import { CITY_IDS, MARKET_ID, isInServiceArea, type CityId, type MarketId } from './market';
import type { Fulfilment, JobsiteFields, Receiving, StoreOrder } from './marketplace';
import type { QuoteAttachment, QuoteRequest } from './quotes';
import { WEEKDAY_NAMES, isLocalDate, parseClock, toClock } from './time-zone';
import type { LatLng, Priority } from './types';
import {
  PICKUP_BOX_LENGTHS_FT,
  VEHICLE_CLASS_IDS,
  VEHICLE_EXTRAS,
  VEHICLE_TYPES,
  type VehicleClass,
  type VehicleExtra,
  type VehicleType,
} from './vehicles';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: Partial<Record<keyof T | 'form', string>> };

// ---------- small checks ----------

export function isValidEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL.test(value.trim());
}

export function isStrongPassword(value: string): { ok: boolean; message?: string } {
  if (value.length < 8) return { ok: false, message: 'Use at least 8 characters.' };
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return { ok: false, message: 'Use letters and at least one number.' };
  }
  return { ok: true };
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

export function isPriority(value: unknown): value is Priority {
  return isOneOf(PRIORITIES, value);
}

export function isVehicleType(value: unknown): value is VehicleType {
  return isOneOf(VEHICLE_TYPES, value);
}

export function isVehicleClass(value: unknown): value is VehicleClass {
  return isOneOf(VEHICLE_CLASS_IDS, value);
}

export function isCityId(value: unknown): value is CityId {
  return isOneOf(CITY_IDS, value);
}

export function isCategoryId(value: unknown): value is CategoryId {
  return isOneOf(CATEGORY_IDS, value);
}

export function isSellUnit(value: unknown): value is SellUnit {
  return isOneOf(SELL_UNITS, value);
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

// ---------- phones and postal codes (§1.1) ----------

/** The national part of a NANP number: neither the area code nor the exchange starts with 0 or 1. */
const NANP_NATIONAL = '[2-9]\\d{2}[2-9]\\d{6}';
/** What a person types, once spaces, dashes, dots and brackets are gone: 10 digits, `1` + 10, or `+1` + 10. */
const NANP_TYPED = new RegExp(`^(?:\\+?1)?(${NANP_NATIONAL})$`);
/** The stored form. The security rules use the same pattern (§6.1 `isNanp`). */
const NANP_E164 = new RegExp(`^\\+1${NANP_NATIONAL}$`);

/**
 * A phone number as E.164, or null when it is not a Canadian/US (NANP) number. Accepts 10 digits,
 * `1` plus 10 digits and `+1…`, with spaces, dashes, dots and brackets: `4165550101`,
 * `1-416-555-0101`, `+1 (647) 555-0199`. The area code and the exchange cannot start with 0 or 1
 * (`0165550101` is refused), and other countries are refused (`+442079460958`). The result always
 * matches the rules' `^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$`.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const national = NANP_TYPED.exec(input.replace(/[\s().-]/g, ''))?.[1];
  return national === undefined ? null : `+1${national}`;
}

/** True for a string that already is a NANP number in E.164, `+1NXXNXXXXXX`. Nothing is cleaned up. */
export function isNanpPhone(value: unknown): value is string {
  return typeof value === 'string' && NANP_E164.test(value);
}

/** Canada Post never uses D, F, I, O, Q or U, and no code starts with W or Z. */
const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;

/**
 * A Canadian postal code of any province as `A1A 1A1`, or null when it is not one: `m5v2t6` →
 * `M5V 2T6`. The letters D, F, I, O, Q and U are never used, and W and Z never come first.
 */
export function normalizePostalCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return POSTAL_CODE.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : null;
}

/**
 * True for a postal code, in any spelling `normalizePostalCode` accepts, whose first letter is one of
 * Ontario's: K, L, M, N or P. Jobsites and stores must be in Ontario (§1.1).
 */
export function isOntarioPostalCode(value: string | null | undefined): boolean {
  const code = normalizePostalCode(value);
  return code !== null && /^[KLMNP]/.test(code);
}

// ---------- ids (§1.1) ----------

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * True for an id a client may retry with: a UUIDv4 in lower case, as `checkoutId`, `requestId` and
 * `issueId` must be (D17). The id becomes the document id, so the upper-case spelling of the same
 * UUID would be another document: it is refused.
 */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

const STORE_ID_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';
const STORE_ID = new RegExp(`^${STORE_ID_PATTERN}$`);

/**
 * True for a store id: a slug of lower-case letters and digits with single dashes, 3–40 characters,
 * such as `kestrel-lumber`. It can never contain `--`, which separates the store from the SKU in a
 * product id (§1.1).
 */
export function isStoreId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 40 && STORE_ID.test(value);
}

// ---------- how a validator is put together ----------

/** One checked field: its cleaned value, or the message a form shows under it. */
type Field<V> = { ok: true; value: V } | { ok: false; message: string };

const pass = <V>(value: V): Field<V> => ({ ok: true, value });
const fail = (message: string): Field<never> => ({ ok: false, message });

/**
 * Gathers the checked fields into one result. The argument must name every field of `T`, so a field
 * that is added to a contract cannot be forgotten here: the validator stops compiling.
 */
function collect<T extends object>(fields: { [K in keyof T]-?: Field<T[K]> }): ValidationResult<T> {
  const errors: Partial<Record<keyof T | 'form', string>> = {};
  const value: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const field: Field<T[keyof T]> = fields[key];
    if (field.ok) value[key] = field.value;
    else errors[key] = field.message;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // Every field of T was checked in the loop and none failed, so `value` holds all of them.
  return { ok: true, value: value as T };
}

/**
 * Like `collect`, for a change request: a field that is not in `input` is neither checked nor
 * returned, and a field the contract does not know is dropped.
 */
function collectPresent<T extends object>(
  input: Record<string, unknown>,
  checks: { [K in keyof T]-?: (given: unknown) => Field<Exclude<T[K], undefined>> },
): ValidationResult<Partial<T>> {
  const errors: Partial<Record<keyof T | 'form', string>> = {};
  const value: Partial<T> = {};
  for (const key of Object.keys(checks) as (keyof T & string)[]) {
    const given = input[key];
    if (given === undefined) continue;
    const field: Field<Exclude<T[keyof T & string], undefined>> = checks[key](given);
    if (field.ok) value[key] = field.value;
    else errors[key] = field.message;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** The first message of a nested check, for a field that is an object (an address, the week's hours). */
const firstMessage = (errors: Partial<Record<string, string>>, fallback: string): string =>
  Object.values(errors).find((message) => message !== undefined) ?? fallback;

/** The members of a string union, written as the keys of a record so the compiler checks none is missing. */
const membersOf = <T extends string>(members: Record<T, true>): readonly T[] => Object.keys(members) as T[];

/**
 * True for a plain object, the only thing a validator reads fields from. A list, a Map or a Date is
 * not one, so a field name can never land on a built-in getter such as `size` and throw.
 */
const isPlainObject = (raw: unknown): raw is Record<string, unknown> =>
  Object.prototype.toString.call(raw) === '[object Object]';

/** Untrusted input as a plain object; anything else (nothing, text, a list) reads as an empty one. */
const asRecord = (raw: unknown): Record<string, unknown> => (isPlainObject(raw) ? raw : {});

/** Left empty: nothing at all, or only white space. */
const isMissing = (value: unknown): boolean =>
  value == null || (typeof value === 'string' && value.trim() === '');

/** One line of text: trimmed, with every run of white space as a single space. */
const oneLine = (value: unknown): string | null => cleanText(value, Infinity);

/** Text that may run over several lines (instructions, a description): only its ends are trimmed. */
const severalLines = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return value.replace(/\r\n?/g, '\n').trim() || null;
};

/** A decimal number as a person types it; `Number` alone would also read `0x1F` or `0b11`. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** -0 comes back as 0: Firestore stores -0 as a double, which the `is int` rules refuse (§6.3). */
const toNumber = (value: unknown): number | null => {
  let parsed: number | null = null;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && DECIMAL.test(value.trim())) parsed = Number(value.trim());
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return parsed === 0 ? 0 : parsed;
};

/** Yes or no as a form or an import row gives it; null for anything else. */
const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(word)) return true;
  if (['false', 'no', 'n', '0'].includes(word)) return false;
  return null;
};

/**
 * `today` comes from the caller's clock, never from a person, so a malformed one is a bug in the
 * caller. It is refused loudly rather than letting every date check quietly pass or fail.
 */
function assertToday(today: string): void {
  if (!isLocalDate(today)) throw new RangeError(`today must be a Toronto date, YYYY-MM-DD: ${String(today)}`);
}

// ---------- field checks ----------
// Each takes one message: it states the whole rule, so it is right whatever was wrong.

function text(value: unknown, min: number, max: number, message: string, clean = oneLine): Field<string> {
  const cleaned = clean(value);
  return cleaned !== null && cleaned.length >= min && cleaned.length <= max ? pass(cleaned) : fail(message);
}

/** A text that may be left empty; empty comes back as null. */
function optionalText(value: unknown, max: number, message: string, clean = oneLine): Field<string | null> {
  if (isMissing(value)) return pass(null);
  const cleaned = clean(value);
  return cleaned !== null && cleaned.length <= max ? pass(cleaned) : fail(message);
}

function integer(value: unknown, min: number, max: number, message: string): Field<number> {
  const parsed = toNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? pass(parsed)
    : fail(message);
}

function optionalInteger(value: unknown, min: number, max: number, message: string): Field<number | null> {
  return isMissing(value) ? pass(null) : integer(value, min, max, message);
}

/** A choice from a list. Every id in the contracts is lower case, so `Sheet` in an import row is `sheet`. */
function oneOf<T extends string>(value: unknown, list: readonly T[], message: string): Field<T> {
  const cleaned = typeof value === 'string' ? value.trim().toLowerCase() : value;
  return isOneOf(list, cleaned) ? pass(cleaned) : fail(message);
}

function optionalOneOf<T extends string>(
  value: unknown,
  list: readonly T[],
  message: string,
): Field<T | null> {
  return isMissing(value) ? pass(null) : oneOf(value, list, message);
}

function flag(value: unknown, message: string): Field<boolean> {
  const parsed = toBoolean(value);
  return parsed === null ? fail(message) : pass(parsed);
}

function phone(value: unknown, message: string): Field<string> {
  const normalized = typeof value === 'string' ? normalizePhone(value) : null;
  return normalized === null ? fail(message) : pass(normalized);
}

function optionalPhone(value: unknown, message: string): Field<string | null> {
  return isMissing(value) ? pass(null) : phone(value, message);
}

function optionalEmail(value: unknown): Field<string | null> {
  if (isMissing(value)) return pass(null);
  const cleaned = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isValidEmail(cleaned) && cleaned.length <= 254
    ? pass(cleaned)
    : fail('Enter a valid email address.');
}

/** A map pin inside the area InstaSupply serves; the rules test the same box (§6.1 `inServiceArea`). */
function pin(value: unknown, message: string): Field<LatLng> {
  const given = asRecord(value);
  const point = { lat: toNumber(given.lat), lng: toNumber(given.lng) };
  return isValidLatLng(point) && isInServiceArea(point)
    ? pass({ lat: point.lat, lng: point.lng })
    : fail(message);
}

function province(value: unknown): Field<'ON'> {
  // No form asks for the province: InstaSupply serves Ontario only (§1.1), so a missing one is Ontario.
  if (isMissing(value)) return pass('ON');
  return typeof value === 'string' && value.trim().toUpperCase() === 'ON'
    ? pass('ON')
    : fail('InstaSupply delivers in Ontario only.');
}

function postalCode(value: unknown, required: boolean): Field<string | null> {
  if (isMissing(value)) {
    // A new build may have no postal code yet; its pin alone locates it (§6.3).
    return required ? fail('Enter the postal code, like M9W 5L4.') : pass(null);
  }
  const code = typeof value === 'string' ? normalizePostalCode(value) : null;
  if (code === null) return fail('Enter a postal code like M4M 2E3.');
  return isOntarioPostalCode(code)
    ? pass(code)
    : fail('Enter an Ontario postal code: it starts with K, L, M, N or P.');
}

function addressFields(
  input: Record<string, unknown>,
  postalCodeRequired: boolean,
): { [K in keyof PostalAddress]: Field<PostalAddress[K]> } {
  return {
    line1: text(input.line1, 3, 160, 'Enter the street address or the lot, in 3 to 160 characters.'),
    line2: optionalText(input.line2, 60, 'The unit or lot can have up to 60 characters.'),
    city: text(input.city, 1, 60, 'Enter the city, in up to 60 characters.'),
    province: province(input.province),
    postalCode: postalCode(input.postalCode, postalCodeRequired),
  };
}

/** `HH:MM` on the 24-hour clock, as store hours and cut-offs are stored (§1.1). */
function clock(value: unknown, message: string): Field<string> {
  const minutes = typeof value === 'string' ? parseClock(value.trim()) : null;
  return minutes === null ? fail(message) : pass(toClock(minutes));
}

/** One day of store hours: closed (null), or one interval that ends after it starts (§4.2). */
function dayHours(value: unknown, day: Weekday): Field<DayHours | null> {
  const name = WEEKDAY_NAMES[day];
  if (value === null) return pass(null);
  if (value === undefined) return fail(`Set the hours for ${name}, or mark it closed.`);
  const given = asRecord(value);
  const open = typeof given.open === 'string' ? parseClock(given.open.trim()) : null;
  const close = typeof given.close === 'string' ? parseClock(given.close.trim()) : null;
  if (open === null || close === null) return fail(`${name}: use 24-hour times like 07:00 and 17:30.`);
  // One interval per day and no overnight hours, so the day must close after it opens.
  if (close <= open) return fail(`${name}: the closing time must be after the opening time.`);
  return pass({ open: toClock(open), close: toClock(close) });
}

function weekHours(value: unknown): Field<Record<Weekday, DayHours | null>> {
  const given = asRecord(value);
  const week = collect<Record<Weekday, DayHours | null>>({
    mon: dayHours(given.mon, 'mon'),
    tue: dayHours(given.tue, 'tue'),
    wed: dayHours(given.wed, 'wed'),
    thu: dayHours(given.thu, 'thu'),
    fri: dayHours(given.fri, 'fri'),
    sat: dayHours(given.sat, 'sat'),
    sun: dayHours(given.sun, 'sun'),
  });
  return week.ok
    ? pass(week.value)
    : fail(firstMessage(week.errors, 'Set the hours for every day of the week.'));
}

const MAX_CLOSURES = 60;

/**
 * A store's extra closed dates: real dates, each once, in order, at most 60. With `notBefore`, a date
 * before it is refused: that is how the portal catches a typed 2025 for 2026.
 */
function closures(value: unknown, notBefore: string | null): Field<string[]> {
  if (!Array.isArray(value)) return fail('List the dates the store is closed, like 2026-12-24.');
  const dates = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!isLocalDate(entry)) return fail('Write each closure date like 2026-12-24.');
    if (notBefore !== null && entry < notBefore) return fail('A closure date cannot be in the past.');
    dates.add(entry);
  }
  if (dates.size > MAX_CLOSURES) return fail(`A store can list up to ${MAX_CLOSURES} closure dates.`);
  return pass([...dates].sort());
}

const PREP_MINUTES_MESSAGE = 'Preparation time must be 5 to 240 minutes.';
const CUTOFF_MESSAGE = 'Enter the same-day cut-off as a 24-hour time like 15:00.';
const STORE_PHONE_MESSAGE = 'Enter a Canadian or US phone number, like (416) 555-0120.';
const DESCRIPTION_MESSAGE = 'The description can have up to 2,000 characters.';

/** A description may be empty, but it is always text: the documents store `''`, never null. */
function description(value: unknown): Field<string> {
  if (isMissing(value)) return pass('');
  return text(value, 0, 2000, DESCRIPTION_MESSAGE, severalLines);
}

/** An upload under one of the Storage folders (§6.4). Whether the file exists is checked on the server. */
function uploadPath(
  value: unknown,
  shape: RegExp,
  message: string,
  folder: string | null = null,
): Field<string> {
  return typeof value === 'string' && shape.test(value) && (folder === null || value.startsWith(folder))
    ? pass(value)
    : fail(message);
}

function optionalUploadPath(
  value: unknown,
  shape: RegExp,
  message: string,
  folder: string | null = null,
): Field<string | null> {
  return isMissing(value) ? pass(null) : uploadPath(value, shape, message, folder);
}

/**
 * The folder an upload must sit in, from the owning ids (§5.4, §5.5.6, §5.5.7, §6.4): the path is the
 * only link between a quote and the files attached to it, so a server must always pass the ids.
 * Without them only the shape of the path is checked (a form that does not know them yet).
 */
function folderOf(...segments: (string | undefined)[]): string | null {
  return segments.every((segment): segment is string => typeof segment === 'string' && segment !== '')
    ? `${segments.join('/')}/`
    : null;
}

const PRODUCT_PHOTO_PATH = new RegExp(`^${STORAGE_FOLDERS.productPhotos}/${STORE_ID_PATTERN}/[^/]+$`);
const STORE_PHOTO_PATH = new RegExp(`^${STORAGE_FOLDERS.storePhotos}/${STORE_ID_PATTERN}/[^/]+$`);
const QUOTE_UPLOAD_PATH = new RegExp(`^${STORAGE_FOLDERS.quoteUploads}/[^/]+/[^/]+/[^/]+$`);
const ISSUE_PHOTO_PATH = new RegExp(`^${STORAGE_FOLDERS.issuePhotos}/[^/]+/[^/]+$`);

// ---------- jobsites (§6.3 isValidJobsite) ----------

const RECEIVING = membersOf<Receiving>({ attended: true, unattended: true });

/**
 * A jobsite as the customer saves it. Label 1–40; line 1 3–160; line 2 up to 60; city 1–60; province
 * ON; an Ontario postal code, or none for a new build that only has a pin; the pin inside
 * `SERVICE_AREA`; one of the 15 cities; area label 1–80; contact name 1–80; a NANP contact phone;
 * instructions up to 500; who receives; and an optional largest vehicle. Text is trimmed, the phone
 * and the postal code come back normalized.
 */
export function validateJobsite(raw: unknown): ValidationResult<JobsiteFields> {
  const input = asRecord(raw);
  return collect<JobsiteFields>({
    label: text(input.label, 1, 40, 'Give the jobsite a name of up to 40 characters.'),
    ...addressFields(input, false),
    location: pin(input.location, 'Drop the pin on the jobsite, inside the Greater Toronto Area.'),
    cityId: oneOf(input.cityId, CITY_IDS, 'Choose the city the jobsite is in.'),
    areaLabel: text(input.areaLabel, 1, 80, 'Enter the area of the jobsite, in up to 80 characters.'),
    contactName: text(
      input.contactName,
      1,
      80,
      'Enter the name of the site contact, in up to 80 characters.',
    ),
    contactPhone: phone(
      input.contactPhone,
      'Enter a Canadian or US phone number for the site contact, like (416) 555-0110.',
    ),
    instructions: optionalText(
      input.instructions,
      500,
      'Site instructions can have up to 500 characters.',
      severalLines,
    ),
    receiving: oneOf(
      input.receiving,
      RECEIVING,
      'Choose whether someone will be on site to receive the load.',
    ),
    maxVehicleClass: optionalOneOf(
      input.maxVehicleClass,
      VEHICLE_CLASS_IDS,
      'Choose the largest vehicle that fits the site, or none.',
    ),
  });
}

// ---------- products (§6.3 isValidProduct) ----------

/** The fields of a listing that a person edits. The server owns the rest (`reserved`, `listed`, …). */
export type ProductInput = Pick<
  Product,
  | 'sku'
  | 'name'
  | 'brand'
  | 'categoryId'
  | 'familyKey'
  | 'unit'
  | 'size'
  | 'description'
  | 'priceCents'
  | 'compareAtCents'
  | 'stockOnHand'
  | 'maxPerOrder'
  | 'weightKg'
  | 'dimsCm'
  | 'shipEstimated'
  | 'active'
  | 'featured'
  | 'badge'
  | 'imageKey'
  | 'imagePath'
>;

const PRODUCT_BADGES = membersOf<ProductBadge>({ new: true, bestseller: true, deal: true });

/** The SKU becomes part of the product id (§1.1), so it needs a letter or a digit to make a slug from. */
function sku(value: unknown): Field<string> {
  const message = 'Enter a SKU of up to 40 characters, with at least one letter or digit.';
  const checked = text(value, 1, 40, message);
  return checked.ok && !/[a-z0-9]/i.test(checked.value) ? fail(message) : checked;
}

/** A strike-through price only makes sense above the price itself. */
function compareAtPrice(value: unknown, price: Field<number>): Field<number | null> {
  if (isMissing(value)) return pass(null);
  const cents = toNumber(value);
  const floor = price.ok ? price.value : 0;
  return cents !== null && Number.isSafeInteger(cents) && cents > floor
    ? pass(cents)
    : fail('The compare-at price must be higher than the price, or empty.');
}

/** Shipping weight of one sell unit, to the gram (§1.1): above 0 and at most 3 000 kg. */
function weightKg(value: unknown): Field<number> {
  const kg = toNumber(value);
  const rounded = kg === null ? null : Math.round(kg * 1000) / 1000;
  return rounded !== null && rounded > 0 && rounded <= 3000
    ? pass(rounded)
    : fail('Enter the weight of one unit in kg: above 0 and at most 3,000.');
}

const hasAnySide = (value: unknown): boolean => {
  const given = asRecord(value);
  return !isMissing(given.l) || !isMissing(given.w) || !isMissing(given.h);
};

/**
 * The same three sides with `l` the longest, then `w`, then `h` (§1.1: `l` = longest side). The load
 * rules read `l` as the length and `l`/`w` as the sheet test (§3.3), so a 4×8 sheet typed width-first
 * must be stored as 244 × 122 × 1.3, not as a 122 cm piece that fits in a car.
 */
function longestFirst(dims: DimsCm): DimsCm {
  const [l = 0, w = 0, h = 0] = [dims.l, dims.w, dims.h].sort((a, b) => b - a);
  return { l, w, h };
}

/**
 * Shipping size of one sell unit, to the millimetre (§1.1). The limits are the rules' own: every side
 * above 0 and the length at most 1 500 cm. The sides may be typed in any order; they come back longest
 * first, so the 1 500 cm cap applies to the longest side whichever box it was typed in.
 */
function dimsCm(value: unknown): Field<DimsCm> {
  const given = asRecord(value);
  const side = (raw: unknown): number | null => {
    const cm = toNumber(raw);
    return cm === null ? null : Math.round(cm * 10) / 10;
  };
  const l = side(given.l);
  const w = side(given.w);
  const h = side(given.h);
  if (l === null || w === null || h === null || !(l > 0 && w > 0 && h > 0)) {
    return fail(
      'Enter the length, width and height of one unit in cm: each above 0, the length at most 1,500.',
    );
  }
  const sorted = longestFirst({ l, w, h });
  return sorted.l <= 1500
    ? pass(sorted)
    : fail('Enter the length, width and height of one unit in cm: each above 0, the length at most 1,500.');
}

/**
 * A product from the catalogue form or an import row. Name 2–120; SKU 1–40; brand up to 60; a known
 * category and unit; size up to 60; price 1–10 000 000 cents; a compare-at price above the price or
 * none; stock 0–1 000 000; max per order 1–9 999 or none; weight above 0 and at most 3 000 kg; length
 * above 0 and at most 1 500 cm, width and height above 0; description up to 2 000. When the weight or
 * the size is missing it comes from the category's shipping defaults and `shipEstimated` is true.
 */
export function validateProduct(raw: unknown, storeId?: string): ValidationResult<ProductInput> {
  const input = asRecord(raw);
  const categoryId = oneOf(input.categoryId, CATEGORY_IDS, 'Choose a category.');
  const defaults = categoryId.ok ? CATEGORIES[categoryId.value] : null;
  const priceCents = integer(input.priceCents, 1, 10_000_000, 'Enter a price from $0.01 to $100,000.00.');
  const weightGiven = !isMissing(input.weightKg);
  const sizeGiven = hasAnySide(input.dimsCm);
  const needsCategory =
    'Choose a category first: its usual weight and size are used when you leave these empty.';

  return collect<ProductInput>({
    sku: sku(input.sku),
    name: text(input.name, 2, 120, 'Enter a product name of 2 to 120 characters.'),
    brand: optionalText(input.brand, 60, 'The brand can have up to 60 characters.'),
    categoryId,
    familyKey: optionalText(input.familyKey, 60, 'The family key can have up to 60 characters.'),
    unit: oneOf(input.unit, SELL_UNITS, 'Choose how the product is sold: each, sheet, box and so on.'),
    size: optionalText(input.size, 60, 'The size can have up to 60 characters.'),
    description: description(input.description),
    priceCents,
    compareAtCents: compareAtPrice(input.compareAtCents, priceCents),
    stockOnHand: integer(
      input.stockOnHand,
      0,
      1_000_000,
      'Stock on hand must be a whole number from 0 to 1,000,000.',
    ),
    maxPerOrder: optionalInteger(
      input.maxPerOrder,
      1,
      9_999,
      'The limit per order must be a whole number from 1 to 9,999, or empty.',
    ),
    // A supplier row without weight or size ships as its category usually does (§1.5).
    weightKg: weightGiven
      ? weightKg(input.weightKg)
      : defaults
        ? pass(defaults.defaultWeightKg)
        : fail(needsCategory),
    dimsCm: sizeGiven
      ? dimsCm(input.dimsCm)
      : defaults
        ? pass(longestFirst(defaults.defaultDimsCm))
        : fail(needsCategory),
    // Estimated when a default was filled in, or when the supplier says their numbers are a guess.
    shipEstimated: pass(!weightGiven || !sizeGiven || toBoolean(input.shipEstimated) === true),
    // A listing is made to be sold: an import row without the column is active.
    active: isMissing(input.active)
      ? pass(true)
      : flag(input.active, 'Choose whether the product is for sale.'),
    featured: isMissing(input.featured)
      ? pass(false)
      : flag(input.featured, 'Choose whether the product is featured.'),
    badge: optionalOneOf(input.badge, PRODUCT_BADGES, 'Choose a badge (new, bestseller or deal), or none.'),
    imageKey: optionalText(input.imageKey, 60, 'The artwork key can have up to 60 characters.'),
    imagePath: optionalUploadPath(
      input.imagePath,
      PRODUCT_PHOTO_PATH,
      'Upload the photo again.',
      folderOf(STORAGE_FOLDERS.productPhotos, storeId),
    ),
  });
}

// ---------- stores (§5.4) ----------

const FULFILMENT_MESSAGE = 'Choose whether the store delivers and whether it offers pickup.';

/** The delivery and pickup switches of a change request: only the ones that were sent. */
function fulfilmentPatch(value: unknown): Field<{ delivery?: boolean; pickup?: boolean }> {
  if (!isPlainObject(value)) return fail(FULFILMENT_MESSAGE);
  const patch: { delivery?: boolean; pickup?: boolean } = {};
  for (const key of ['delivery', 'pickup'] as const) {
    if (value[key] === undefined) continue;
    const parsed = toBoolean(value[key]);
    if (parsed === null) return fail(FULFILMENT_MESSAGE);
    patch[key] = parsed;
  }
  return pass(patch);
}

/**
 * What a store owner changes in the portal (`updateStoreProfile`). Only the fields that are present
 * are checked and returned: hours (per weekday closed, or `HH:MM` with close after open); at most 60
 * closure dates, none before `today`; prep 5–240 minutes; the same-day cut-off as `HH:MM`; a NANP
 * phone and order-alert phone. `today` is the Toronto date.
 *
 * A stored closure date that has passed is refused like a mistyped one, so the portal sends only the
 * dates from today on. Throws a `RangeError` when `today` is not a date.
 */
export function validateStoreProfile(
  raw: unknown,
  today: string,
  storeId?: string,
): ValidationResult<StoreProfilePatch> {
  assertToday(today);
  return collectPresent<StoreProfilePatch>(asRecord(raw), {
    description,
    phone: (given) => phone(given, STORE_PHONE_MESSAGE),
    email: optionalEmail,
    hours: weekHours,
    closures: (given) => closures(given, today),
    prepMinutes: (given) => integer(given, 5, 240, PREP_MINUTES_MESSAGE),
    sameDayCutoff: (given) => clock(given, CUTOFF_MESSAGE),
    acceptingOrders: (given) => flag(given, 'Choose whether the store is taking new orders.'),
    fulfilment: fulfilmentPatch,
    photoPath: (given) =>
      optionalUploadPath(
        given,
        STORE_PHOTO_PATH,
        'Upload the photo again.',
        folderOf(STORAGE_FOLDERS.storePhotos, storeId),
      ),
    loadingNotes: (given) =>
      optionalText(given, 500, 'Loading notes can have up to 500 characters.', severalLines),
    alertPhone: (given) =>
      optionalPhone(given, 'Enter a Canadian or US mobile number for order alerts, like (416) 555-0120.'),
  });
}

/** A whole store as `createStore` takes it. */
export type StoreInput = CreateStoreRequest['store'];

const STORE_SPECIALTIES = Object.keys(STORE_SPECIALTY_LABELS) as StoreSpecialty[];
const STORE_STATUSES = membersOf<StoreStatus>({
  onboarding: true,
  coming_soon: true,
  live: true,
  closed: true,
});

/** The categories a store carries: known ids in the order given (a lumber yard lists wood first), each once. */
function categoryIds(value: unknown): Field<CategoryId[]> {
  const message = 'Choose the categories the store carries from the list.';
  if (!Array.isArray(value)) return fail(message);
  const given = value as unknown[];
  return given.every(isCategoryId) ? pass([...new Set(given)]) : fail(message);
}

function market(value: unknown): Field<MarketId> {
  return value === MARKET_ID
    ? pass(MARKET_ID)
    : fail('InstaSupply serves one market: the Greater Toronto Area.');
}

/** A store has a civic address, so unlike a jobsite it always has a postal code. */
function storeAddress(value: unknown): Field<PostalAddress> {
  const address = collect<PostalAddress>(addressFields(asRecord(value), true));
  return address.ok
    ? pass(address.value)
    : fail(firstMessage(address.errors, 'Enter the address of the store.'));
}

function storeFulfilment(value: unknown): Field<Store['fulfilment']> {
  const given = asRecord(value);
  const delivery = toBoolean(given.delivery);
  const pickup = toBoolean(given.pickup);
  const radius = toNumber(given.deliveryRadiusKm);
  if (delivery === null || pickup === null) return fail(FULFILMENT_MESSAGE);
  if (radius === null || radius < 1 || radius > 60) return fail('Set a delivery radius of 1 to 60 km.');
  return pass({ delivery, pickup, deliveryRadiusKm: radius });
}

/** The server fills this in from an upload, so all that is checked is that it is a web address. */
function photoUrl(value: unknown): Field<string | null> {
  if (isMissing(value)) return pass(null);
  return typeof value === 'string' && /^https?:\/\/\S+$/.test(value) && value.length <= 2000
    ? pass(value)
    : fail('The photo link must be a web address.');
}

/**
 * A whole store document for `createStore`, and for `updateStoreSettings` after the change is merged
 * in: a name, a known specialty, categories, city and status, a pin, a full Ontario address, a NANP
 * phone, valid hours, closures, prep time and cut-off as in `validateStoreProfile`, and a delivery
 * radius of 1–60 km. Closure dates may lie in the past here: an existing store keeps its history.
 */
export function validateStore(raw: unknown): ValidationResult<StoreInput> {
  const input = asRecord(raw);
  return collect<StoreInput>({
    name: text(input.name, 2, 80, 'Enter the store name, in 2 to 80 characters.'),
    specialty: oneOf(input.specialty, STORE_SPECIALTIES, 'Choose what the store specializes in.'),
    categoryIds: categoryIds(input.categoryIds),
    description: description(input.description),
    marketId: market(input.marketId),
    cityId: oneOf(input.cityId, CITY_IDS, 'Choose the city the store is in.'),
    areaLabel: text(
      input.areaLabel,
      1,
      80,
      'Enter the area shown on the store card, in up to 80 characters.',
    ),
    address: storeAddress(input.address),
    // Inside the service area, like a jobsite pin: that also catches a latitude and a longitude typed
    // the wrong way round, which would put the store in Antarctica.
    location: pin(input.location, 'Drop the pin on the store, inside the Greater Toronto Area.'),
    phone: phone(input.phone, STORE_PHONE_MESSAGE),
    email: optionalEmail(input.email),
    photoUrl: photoUrl(input.photoUrl),
    imageKey: optionalText(input.imageKey, 60, 'The artwork key can have up to 60 characters.'),
    hours: weekHours(input.hours),
    closures: closures(input.closures, null),
    fulfilment: storeFulfilment(input.fulfilment),
    prepMinutes: integer(input.prepMinutes, 5, 240, PREP_MINUTES_MESSAGE),
    sameDayCutoff: clock(input.sameDayCutoff, CUTOFF_MESSAGE),
    status: oneOf(input.status, STORE_STATUSES, 'Choose the status of the store.'),
    acceptingOrders: flag(input.acceptingOrders, 'Choose whether the store is taking new orders.'),
  });
}

/**
 * `validateStore` as a yes or no, under the name the callable table uses (§5.4). To save a store, take
 * the cleaned `value` of `validateStore` instead: `raw` may still hold a phone typed with brackets.
 */
export function isValidStore(raw: unknown): raw is StoreInput {
  return validateStore(raw).ok;
}

// ---------- drivers (§5.4 registerDriver) ----------

/** Shown to the store at the counter ("Ford F-150 · CBKX 214"): letters, digits, spaces and dashes only. */
function plate(value: unknown): Field<string> {
  const message = 'Enter the licence plate in 2 to 10 letters and numbers, like CBKX 214.';
  const checked = text(typeof value === 'string' ? value.toUpperCase() : value, 2, 10, message);
  return checked.ok && !/^[A-Z0-9][A-Z0-9 -]*$/.test(checked.value) ? fail(message) : checked;
}

/**
 * The box length decides a pickup's class (§3.3), so a pickup must have one. No other vehicle has a
 * box: whatever a form left behind when the type was changed is cleared, not reported.
 */
function boxLengthFt(value: unknown, type: Field<VehicleType>): Field<DriverVehicleInput['boxLengthFt']> {
  if (!type.ok || type.value !== 'pickup') return pass(null);
  const feet = toNumber(value);
  const length = PICKUP_BOX_LENGTHS_FT.find((allowed) => allowed === feet);
  return length === undefined ? fail('Choose the box length of the pickup: 5.5, 6.5 or 8 ft.') : pass(length);
}

function payloadKg(value: unknown): Field<number | null> {
  if (isMissing(value)) return pass(null);
  const kg = toNumber(value);
  return kg !== null && kg > 0 ? pass(kg) : fail('Enter the payload in kg, or leave it empty.');
}

/** Known extras, each once. */
function extras(value: unknown): Field<VehicleExtra[]> {
  if (value == null) return pass([]);
  const message = 'Choose the extras from the list.';
  if (!Array.isArray(value)) return fail(message);
  const given = value as unknown[];
  return given.every((extra): extra is VehicleExtra => isOneOf(VEHICLE_EXTRAS, extra))
    ? pass([...new Set(given)])
    : fail(message);
}

/**
 * The vehicle a driver declares. A known type; make and model; year from 1995 to next year (counted
 * from `today`, the Toronto date); plate 2–10 characters; a box length for pickups, and only for
 * pickups; an optional payload above 0; known extras without repeats. Throws a `RangeError` when
 * `today` is not a date.
 */
export function validateDriverVehicle(raw: unknown, today: string): ValidationResult<DriverVehicleInput> {
  assertToday(today);
  // Next year's models are sold from the autumn on.
  const newestYear = Number(today.slice(0, 4)) + 1;
  const input = asRecord(raw);
  const type = oneOf(input.type, VEHICLE_TYPES, 'Choose the type of vehicle.');
  return collect<DriverVehicleInput>({
    type,
    make: text(input.make, 1, 40, 'Enter the make, like Ford, in up to 40 characters.'),
    model: text(input.model, 1, 40, 'Enter the model, like F-150, in up to 40 characters.'),
    year: integer(input.year, 1995, newestYear, `Enter the model year, from 1995 to ${newestYear}.`),
    plate: plate(input.plate),
    colour: optionalText(input.colour, 30, 'The colour can have up to 30 characters.'),
    boxLengthFt: boxLengthFt(input.boxLengthFt, type),
    payloadKg: payloadKg(input.payloadKg),
    extras: extras(input.extras),
  });
}

// ---------- material lists (§5.5.6) ----------

/** A material list as the form sends it; the id is added by the caller. */
export type MaterialListInput = Omit<SubmitMaterialListRequest, 'requestId'>;

const FULFILMENTS = membersOf<Fulfilment>({ delivery: true, pickup: true });
const NEEDED_BY_KINDS = membersOf<QuoteRequest['neededBy']['kind']>({
  asap: true,
  this_week: true,
  date: true,
});
const CONTACT_WAYS = membersOf<QuoteRequest['contact']['preferred']>({
  call: true,
  whatsapp: true,
  email: true,
});

const MAX_LIST_LINES = 60;
const MAX_LIST_FILES = 5;
/** The Storage rules accept a file below 15 MB (§6.4), and these types. */
const MAX_LIST_FILE_BYTES = 15 * 1024 * 1024;
const LIST_FILE_TYPE =
  /^(?:image\/.*|application\/pdf|text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;

/** The typed lines of a list. A row left completely empty is dropped: forms keep one ready to type in. */
function listLines(value: unknown): Field<MaterialListInput['lines']> {
  if (value == null) return pass([]);
  if (!Array.isArray(value)) return fail('Type your list one item per line.');
  const lines: MaterialListInput['lines'] = [];
  for (const [index, entry] of (value as unknown[]).entries()) {
    const given = asRecord(entry);
    if (isMissing(given.text) && isMissing(given.quantity)) continue;
    const item = `Item ${index + 1}`;
    const described = text(given.text, 2, 120, `${item}: describe it in 2 to 120 characters.`);
    if (!described.ok) return described;
    const quantity = optionalInteger(
      given.quantity,
      1,
      99_999,
      `${item}: the quantity must be a whole number from 1 to 99,999, or empty.`,
    );
    if (!quantity.ok) return quantity;
    lines.push({ text: described.value, quantity: quantity.value });
  }
  return lines.length > MAX_LIST_LINES
    ? fail(`A list can have up to ${MAX_LIST_LINES} items. Attach a file for a longer one.`)
    : pass(lines);
}

/** What the app says it uploaded. The server reads the real size and type from Storage (§5.5.6). */
function attachments(value: unknown, folder: string | null): Field<QuoteAttachment[]> {
  if (value == null) return pass([]);
  if (!Array.isArray(value)) return fail('Attach your files again.');
  const entries = value as unknown[];
  if (entries.length > MAX_LIST_FILES) return fail(`Attach up to ${MAX_LIST_FILES} files.`);
  const files: QuoteAttachment[] = [];
  for (const [index, entry] of entries.entries()) {
    const given = asRecord(entry);
    const file = collect<QuoteAttachment>({
      path: uploadPath(given.path, QUOTE_UPLOAD_PATH, 'upload it again', folder),
      name: text(given.name, 1, 200, 'its name can have up to 200 characters'),
      contentType:
        typeof given.contentType === 'string' && LIST_FILE_TYPE.test(given.contentType)
          ? pass(given.contentType)
          : fail('use a photo, a PDF or a spreadsheet'),
      sizeBytes: integer(given.sizeBytes, 1, MAX_LIST_FILE_BYTES - 1, 'it must be smaller than 15 MB'),
    });
    if (!file.ok) return fail(`File ${index + 1}: ${firstMessage(file.errors, 'attach it again')}.`);
    files.push(file.value);
  }
  return pass(files);
}

function neededBy(value: unknown): Field<QuoteRequest['neededBy']> {
  const given = asRecord(value);
  const kind = oneOf(
    given.kind,
    NEEDED_BY_KINDS,
    'Choose when you need the materials: as soon as possible, this week or by a date.',
  );
  if (!kind.ok) return kind;
  // Only "pick a date" carries a date (a Toronto date); the other two choices never do.
  if (kind.value !== 'date') return pass({ kind: kind.value, date: null });
  return isLocalDate(given.date)
    ? pass({ kind: 'date', date: given.date })
    : fail('Pick the date you need the materials by.');
}

/** A delivery quote is priced to a jobsite, so delivery needs one; a pickup may name one or not. */
function listJobsiteId(value: unknown, fulfilment: Field<Fulfilment>): Field<string | null> {
  const id = oneLine(value);
  if (id === null) {
    return fulfilment.ok && fulfilment.value === 'delivery'
      ? fail('Choose the jobsite to deliver to.')
      : pass(null);
  }
  return id.length <= 128 && !id.includes('/') ? pass(id) : fail('Choose one of your saved jobsites.');
}

/** How staff reach the customer about the quote: by phone, or by email when that is what they prefer. */
function contact(value: unknown): Field<QuoteRequest['contact']> {
  const given = asRecord(value);
  const preferred = oneOf(
    given.preferred,
    CONTACT_WAYS,
    'Choose how we should reach you: call, WhatsApp or email.',
  );
  if (!preferred.ok) return preferred;
  const number = optionalPhone(given.phone, 'Enter a Canadian or US phone number, like (416) 555-0110.');
  if (!number.ok) return number;
  const email = optionalEmail(given.email);
  if (!email.ok) return email;
  if (preferred.value === 'email' && email.value === null) {
    return fail('Enter the email address we should send the quote to.');
  }
  if (preferred.value !== 'email' && number.value === null) {
    return fail('Enter the phone number we should reach you at.');
  }
  return pass({ preferred: preferred.value, phone: number.value, email: email.value });
}

/**
 * A material list. Up to 60 lines, each 2–120 characters with a quantity of 1–99 999 or none; up to 5
 * attachments; at least one line or one attachment; a needed-by choice, with a date when it is "pick a
 * date"; delivery needs a jobsite; the contact needs a NANP phone, or an email when email is the
 * preferred way.
 */
export function validateMaterialList(
  raw: unknown,
  owner?: { uid: string; requestId: string },
): ValidationResult<MaterialListInput> {
  const input = asRecord(raw);
  const lines = listLines(input.lines);
  const files = attachments(
    input.attachments,
    folderOf(STORAGE_FOLDERS.quoteUploads, owner?.uid, owner?.requestId),
  );
  const fulfilment = oneOf(input.fulfilment, FULFILMENTS, 'Choose delivery or pickup.');
  const result = collect<MaterialListInput>({
    lines,
    attachments: files,
    neededBy: neededBy(input.neededBy),
    fulfilment,
    jobsiteId: listJobsiteId(input.jobsiteId, fulfilment),
    contact: contact(input.contact),
    notes: optionalText(input.notes, 1000, 'Notes can have up to 1,000 characters.', severalLines),
  });
  // An empty list is nobody's field in particular, so it is reported for the form as a whole.
  if (lines.ok && files.ok && lines.value.length === 0 && files.value.length === 0) {
    const form = 'Add at least one item, or attach your list.';
    return { ok: false, errors: result.ok ? { form } : { ...result.errors, form } };
  }
  return result;
}

// ---------- issues (§5.5.7) ----------

/** A problem report as the form sends it; the ids are added by the caller. */
export type IssueReportInput = Omit<ReportIssueRequest, 'issueId' | 'storeOrderId'>;

const ISSUE_TYPES = membersOf<IssueType>({
  damaged: true,
  wrong_item: true,
  missing_item: true,
  short_quantity: true,
  late: true,
  other: true,
});
const RESOLUTIONS = membersOf<IssueReportInput['preferredResolution']>({
  replacement: true,
  refund: true,
  return: true,
});
const MAX_ISSUE_PHOTOS = 6;

/**
 * The affected lines: lines of this store order, each once, with a quantity the customer was actually
 * charged for (`fulfilledQty`, not what was ordered: a shorted unit was never charged) and that was
 * not refunded already (§3.7: a unit is refunded once).
 */
function issueLines(
  value: unknown,
  orderLines: StoreOrder['lines'],
  refunded: ReadonlyMap<string, number>,
): Field<IssueReportInput['lines']> {
  if (value == null) return pass([]);
  if (!Array.isArray(value)) return fail('Choose the items that have a problem.');
  const lines: IssueReportInput['lines'] = [];
  for (const entry of value as unknown[]) {
    const given = asRecord(entry);
    const line = orderLines.find((candidate) => candidate.lineId === given.lineId);
    if (!line) return fail('Choose items from this order.');
    if (lines.some((chosen) => chosen.lineId === line.lineId)) return fail('List each item once.');
    if (line.fulfilledQty < 1) return fail(`${line.name} was not supplied, so you were not charged for it.`);
    const left = line.fulfilledQty - (refunded.get(line.lineId) ?? 0);
    if (left < 1) return fail(`${line.name} was already refunded.`);
    const quantity = integer(
      given.quantity,
      1,
      left,
      left === 1
        ? `${line.name}: the quantity can only be 1.`
        : `${line.name}: choose a quantity from 1 to ${left}.`,
    );
    if (!quantity.ok) return quantity;
    lines.push({ lineId: line.lineId, quantity: quantity.value });
  }
  return pass(lines);
}

/** Up to 6 photos; staff cannot judge a damaged or a wrong item without at least one (§5.5.7). */
function issuePhotos(value: unknown, type: Field<IssueType>, folder: string | null): Field<string[]> {
  if (value != null && !Array.isArray(value)) return fail('Add the photos again.');
  const paths = [...new Set((value ?? []) as unknown[])];
  const inFolder = (path: unknown): path is string =>
    typeof path === 'string' && ISSUE_PHOTO_PATH.test(path) && (folder === null || path.startsWith(folder));
  if (!paths.every(inFolder)) {
    return fail('Add the photos again.');
  }
  if (paths.length > MAX_ISSUE_PHOTOS) return fail(`Add up to ${MAX_ISSUE_PHOTOS} photos.`);
  if (paths.length === 0 && type.ok && (type.value === 'damaged' || type.value === 'wrong_item')) {
    return fail('Add at least one photo of the damaged or wrong item.');
  }
  return pass(paths);
}

/**
 * A problem report for a completed store order. A known type; lines that the store order has, each
 * with a quantity of 1 up to what was fulfilled less what earlier issues already refunded
 * (`refunded`: the lines of its resolved refund issues); a description of 10–1 000 characters; up to
 * 6 photos, and at least one for a damaged or a wrong item; a preferred resolution.
 */
export function validateIssueReport(
  raw: unknown,
  storeOrder: Pick<StoreOrder, 'lines'>,
  issueId?: string,
  refunded: readonly { lineId: string; quantity: number }[] = [],
): ValidationResult<IssueReportInput> {
  const input = asRecord(raw);
  const refundedQty = new Map<string, number>();
  for (const entry of refunded) {
    // Records written by the server; anything that is not a whole count is ignored rather than trusted.
    if (Number.isSafeInteger(entry.quantity) && entry.quantity > 0) {
      refundedQty.set(entry.lineId, (refundedQty.get(entry.lineId) ?? 0) + entry.quantity);
    }
  }
  const type = oneOf(input.type, ISSUE_TYPES, 'Choose what went wrong.');
  return collect<IssueReportInput>({
    type,
    lines: issueLines(input.lines, storeOrder.lines, refundedQty),
    description: text(
      input.description,
      10,
      1000,
      'Describe the problem in 10 to 1,000 characters.',
      severalLines,
    ),
    photoPaths: issuePhotos(input.photoPaths, type, folderOf(STORAGE_FOLDERS.issuePhotos, issueId)),
    preferredResolution: oneOf(
      input.preferredResolution,
      RESOLUTIONS,
      'Choose a replacement, a refund or a return.',
    ),
  });
}

// ---------- manual deliveries ----------

/** Payload used by the create-delivery form, CSV import and the `createDeliveries` callable. */
export interface DeliveryInput {
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  address: string;
  /** Optional when the server can geocode the address. */
  location: LatLng | null;
  addressNotes: string | null;
  notes: string | null;
  packageCount: number;
  priority: Priority;
  requireCode: boolean;
  driverId: string | null;
  /** Epoch ms. */
  windowStart: number | null;
  /** Epoch ms. */
  windowEnd: number | null;
}

/** Validate and normalize untrusted delivery input. Never throws. */
export function validateDeliveryInput(raw: unknown): ValidationResult<DeliveryInput> {
  const input = asRecord(raw);
  const errors: Partial<Record<keyof DeliveryInput | 'form', string>> = {};

  const customerName = cleanText(input.customerName, 120);
  if (!customerName) errors.customerName = 'Customer name is required.';

  const address = cleanText(input.address, 300);
  if (!address) errors.address = 'Address is required.';

  let customerPhone: string | null = null;
  if (typeof input.customerPhone === 'string' && input.customerPhone.trim()) {
    customerPhone = normalizePhone(input.customerPhone);
    if (!customerPhone) errors.customerPhone = 'Enter a valid phone number.';
  }

  let customerEmail: string | null = null;
  if (typeof input.customerEmail === 'string' && input.customerEmail.trim()) {
    customerEmail = input.customerEmail.trim().toLowerCase();
    if (!isValidEmail(customerEmail)) errors.customerEmail = 'Enter a valid email address.';
  }

  let location: LatLng | null = null;
  if (input.location != null) {
    const candidate = asRecord(input.location);
    const point = { lat: toNumber(candidate.lat), lng: toNumber(candidate.lng) };
    if (isValidLatLng(point)) location = point;
    else errors.location = 'Location coordinates are invalid.';
  }

  const packageCount = toNumber(input.packageCount) ?? 1;
  if (!Number.isInteger(packageCount) || packageCount < 1 || packageCount > 99) {
    errors.packageCount = 'Packages must be a whole number between 1 and 99.';
  }

  const priorityRaw = typeof input.priority === 'string' ? input.priority.trim().toLowerCase() : '';
  const priority: Priority = isPriority(priorityRaw) ? priorityRaw : 'normal';
  if (priorityRaw && !isPriority(priorityRaw)) errors.priority = 'Priority must be normal, high or urgent.';

  const windowStart = toNumber(input.windowStart);
  const windowEnd = toNumber(input.windowEnd);
  if (windowStart != null && windowEnd != null && windowEnd <= windowStart) {
    errors.windowEnd = 'The delivery window must end after it starts.';
  }

  const driverId = typeof input.driverId === 'string' && input.driverId.trim() ? input.driverId.trim() : null;

  // The two required texts are named here so the compiler knows they are set below.
  if (!customerName || !address || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      customerName,
      customerPhone,
      customerEmail,
      address,
      location,
      addressNotes: cleanText(input.addressNotes, 300),
      notes: cleanText(input.notes, 500),
      packageCount,
      priority,
      // Off unless the row clearly says yes.
      requireCode: toBoolean(input.requireCode) ?? false,
      driverId,
      windowStart,
      windowEnd,
    },
  };
}

/** Random alphanumeric id from a CSPRNG-backed `randomBytes`-style function. */
export function randomToken(length: number, random: (size: number) => Uint8Array): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = random(length * 2);
  let output = '';
  for (let index = 0; index < bytes.length && output.length < length; index += 1) {
    const byte = bytes[index]!;
    // Rejection sampling keeps the distribution uniform.
    if (byte < Math.floor(256 / alphabet.length) * alphabet.length) {
      output += alphabet[byte % alphabet.length];
    }
  }
  if (output.length < length) return output + randomToken(length - output.length, random);
  return output;
}
