/**
 * Display helpers that are not about money (`money.ts`) or Toronto time (`time-zone.ts`): durations,
 * distances, names, phones and addresses. They never throw: a missing value shows as a dash.
 *
 * `formatRelativeTime`, `formatClock`, `formatDate`, `formatDateTime`, `formatEta` and `startOfDay`
 * are the device helpers: they speak the phone's own locale and time zone, which is right for a chat
 * bubble ("5 min ago") and wrong for anything the business promises. They take `now` (and
 * `startOfDay` its instant) from the caller: shared code never reads the clock itself. Promises, windows, store hours and receipts use the
 * Toronto helpers of `time-zone.ts` (§4.1).
 */
import type { PostalAddress } from './catalog';
import { toMillis, type TimeInput } from './time-zone';
import { normalizePhone } from './validation';

/** "45 s", "12 min", "1 h 05 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return '< 1 min';
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

/** "850 m", "4.2 km", "18 km". */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * The instant to show, or null for anything that is not a number or a `Date`: text, or a timestamp
 * object written by an older build. A screen shows a dash for those; it must not crash on them.
 */
const instantOf = (value: TimeInput): number | null =>
  typeof value === 'number' || value instanceof Date ? toMillis(value) : null;

const CLOCK_SKEW_SECONDS = 120;

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Nov". */
export function formatRelativeTime(value: TimeInput, now: number): string {
  const millis = instantOf(value);
  if (millis == null) return '—';
  const diffSeconds = Math.round((now - millis) / 1000);
  // Server timestamps can run slightly ahead of the device clock; that is still "just now".
  if (diffSeconds < 0 && diffSeconds > -CLOCK_SKEW_SECONDS) return 'just now';
  if (diffSeconds < 0) {
    const ahead = -diffSeconds;
    if (ahead < 60) return 'in < 1 min';
    if (ahead < 3600) return `in ${Math.round(ahead / 60)} min`;
    return `in ${formatDuration(ahead)}`;
  }
  if (diffSeconds < 45) return 'just now';
  if (diffSeconds < 3600) return `${Math.max(1, Math.round(diffSeconds / 60))} min ago`;
  if (diffSeconds < 86_400) return `${Math.round(diffSeconds / 3600)} h ago`;
  if (diffSeconds < 172_800) return 'yesterday';
  return formatDate(millis, now);
}

/**
 * "14:05" in the device's locale and time zone. Fine for chat bubbles; for business times (promises,
 * windows, store hours, receipts) use `formatClockET`, which is always Toronto time (§4.1).
 */
export function formatClock(value: TimeInput): string {
  const millis = instantOf(value);
  if (millis == null) return '—';
  return new Date(millis).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * "12 Nov" (or "12 Nov 2025" when not in the year of `now`), in the device's locale and time zone. For
 * business dates use `formatDayET` or `formatDateTimeET` (§4.1).
 */
export function formatDate(value: TimeInput, now: number): string {
  const millis = instantOf(value);
  if (millis == null) return '—';
  const date = new Date(millis);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "12 Nov, 14:05" in the device's locale and time zone; see `formatDateTimeET` for business times. */
export function formatDateTime(value: TimeInput, now: number): string {
  const millis = instantOf(value);
  if (millis == null) return '—';
  return `${formatDate(millis, now)}, ${formatClock(millis)}`;
}

/** Clock time `seconds` from now: "ETA 14:35". */
export function formatEta(secondsFromNow: number | null | undefined, now: number): string {
  if (secondsFromNow == null || !Number.isFinite(secondsFromNow)) return '—';
  return formatClock(now + secondsFromNow * 1000);
}

export function initials(name: string | null | undefined): string {
  const parts = (typeof name === 'string' ? name : '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  return (typeof name === 'string' ? name : '').trim().split(/\s+/)[0] || 'Customer';
}

/**
 * A phone number as Canadians write it: `+14165550110` → "(416) 555-0110" (§1.1). Accepts whatever
 * `normalizePhone` accepts; anything else is returned as it was typed, and a missing value as a dash.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (typeof phone !== 'string' || phone.trim() === '') return '—';
  const e164 = normalizePhone(phone);
  // Not a Canadian or US number: its grouping is not ours to guess.
  if (e164 === null) return phone.trim();
  return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
}

/**
 * Enough of a number to recognise it without exposing it: the area code and the last four digits,
 * "(416) •••-0110". A missing value shows as a dash.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (typeof phone !== 'string' || phone.trim() === '') return '—';
  const e164 = normalizePhone(phone);
  if (e164 !== null) return `(${e164.slice(2, 5)}) •••-${e164.slice(8)}`;
  // Any other number shows its last four digits, and only when at least three stay hidden.
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? `•••-${digits.slice(-4)}` : '•••';
}

/**
 * One line for labels, the jobsite snapshot (`addressLine`) and the store's `storeAddressLine`:
 * "Pape Ave & Dundas St E, Toronto ON M4M 2E3". `line2` (unit, lot) follows `line1` when present; a
 * pin-only jobsite has no postal code and the line simply ends after the province.
 */
export function formatAddressLine(address: PostalAddress): string {
  if (address == null) return '—';
  const shown = (part: string | null | undefined) => (typeof part === 'string' ? part.trim() : '');
  const street = [address.line1, address.line2].map(shown).filter(Boolean).join(', ');
  const place = [address.city, address.province, address.postalCode].map(shown).filter(Boolean).join(' ');
  return [street, place].filter(Boolean).join(', ') || '—';
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Start of the day `value` falls in, in the device's time zone, in epoch ms. For the Toronto business
 * day ("today" on a store board, a payout run) use `startOfLocalDay(localDateOf(value))` (§4.1).
 */
export function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
