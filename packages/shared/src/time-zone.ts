/**
 * America/Toronto time without `Intl` (§4.1, D14). Every business date (`YYYY-MM-DD`) and clock time
 * (`HH:MM`) in the product is Toronto time, whatever zone the phone, the browser or the server runs in,
 * so the conversion is a fixed rule written out here: the result is identical on Hermes, browsers and
 * Node, and the daylight-saving switches can be tested to the second.
 *
 * Instants are epoch milliseconds (UTC). Nothing in this file reads the device clock or the device
 * time zone: use `Date.UTC` and the `getUTC…` getters only, and take `now` as a parameter.
 */
import type { Weekday } from './catalog';
import type { TimestampLike } from './types';

export type TimeInput = TimestampLike | Date | number | null | undefined;

/** Epoch milliseconds of a timestamp (`TimestampLike` is already a number) or a `Date`; null when missing or invalid. */
export function toMillis(value: TimeInput): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Old documents or untyped JSON may still hold text or a `{ toMillis() }` object: "invalid", not a crash.
  if (!(value instanceof Date)) return null;
  const millis = value.getTime();
  return Number.isFinite(millis) ? millis : null;
}

/** An instant as a Toronto wall clock reads it. */
export interface LocalTime {
  /** `YYYY-MM-DD`. */
  date: string;
  weekday: Weekday;
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 1440;

/** Eastern Daylight Time and Eastern Standard Time, as minutes from UTC. */
const EDT_OFFSET_MINUTES = -240;
const EST_OFFSET_MINUTES = -300;

/** `getUTCDay()` counts from Sunday. */
const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ---------- names ----------
// Written out in English here, never taken from the device locale (§4.1): a phone set to French and a
// server set to UTC must print the same receipt.

/** "Monday" … "Sunday", for sentences such as "Kestrel and Bluestone are closed Sunday" and for the hours editor. */
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** "Mon" … "Sun", as in "Fri, Nov 20" and "Ready Mon 7:15 am". */
export const WEEKDAY_SHORT_NAMES: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const MONTH_SHORT_NAMES: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad2 = (value: number) => String(value).padStart(2, '0');

const isoDate = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;

// ---------- the zone rule ----------

/** Day of the month of the n-th Sunday of a month. */
function nthSunday(year: number, monthIndex: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return 1 + ((7 - firstWeekday) % 7) + 7 * (n - 1);
}

/**
 * Toronto's offset from UTC in minutes at an instant: −240 (EDT) from the 2nd Sunday of March 07:00 UTC
 * until the 1st Sunday of November 06:00 UTC, −300 (EST) otherwise.
 * 2026-03-08T06:59:59Z → −300, 07:00:00Z → −240; 2026-11-01T05:59:59Z → −240, 06:00:00Z → −300.
 */
export function torontoOffsetMinutes(utcMs: number): number {
  // Both switches fall inside one UTC year, so the UTC year of the instant is the year to look at.
  const year = new Date(utcMs).getUTCFullYear();
  // Clocks go forward at 02:00 EST, which is 07:00 UTC, and back at 02:00 EDT, which is 06:00 UTC (D14).
  const edtStart = Date.UTC(year, 2, nthSunday(year, 2, 2), 7);
  const edtEnd = Date.UTC(year, 10, nthSunday(year, 10, 1), 6);
  return utcMs >= edtStart && utcMs < edtEnd ? EDT_OFFSET_MINUTES : EST_OFFSET_MINUTES;
}

/** The wall clock with its date also in parts, so the display helpers need not parse the string again. */
interface WallClock extends LocalTime {
  month: number;
  day: number;
}

/** Null for anything `Date` cannot hold (NaN, ±Infinity, beyond ±8.64e15 ms). */
function wallClockOrNull(utcMs: number): WallClock | null {
  // Shifted by the offset, the UTC getters read Toronto's wall clock. The device zone is never involved.
  const shifted = new Date(utcMs + torontoOffsetMinutes(utcMs) * MINUTE_MS);
  if (Number.isNaN(shifted.getTime())) return null;
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    date: isoDate(year, month, day),
    // The fallback only satisfies the compiler: getUTCDay() is always 0–6.
    weekday: WEEKDAY_BY_UTC_DAY[shifted.getUTCDay()] ?? 'sun',
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    month,
    day,
  };
}

/**
 * The Toronto date, weekday and minutes since midnight of an instant. Thu 2026-11-19 17:25Z → 12:25.
 * Seconds are dropped. Throws a `RangeError` for a value that is not an instant: a wrong date must not
 * be stored quietly.
 */
export function toLocal(utcMs: number): LocalTime {
  const wall = wallClockOrNull(utcMs);
  if (!wall) throw new RangeError(`toLocal: not an instant: ${utcMs}`);
  return { date: wall.date, weekday: wall.weekday, minutes: wall.minutes };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a calendar date; null when the text is not a real `YYYY-MM-DD` date. */
function utcMidnightOrNull(date: unknown): number | null {
  const match = typeof date === 'string' ? DATE_PATTERN.exec(date) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const midnight = new Date(Date.UTC(year, monthIndex, day));
  // Date.UTC rolls 2026-02-30 over into March and reads the years 0–99 as 1900–1999; a real date reads
  // back as it was written.
  if (
    midnight.getUTCFullYear() !== year ||
    midnight.getUTCMonth() !== monthIndex ||
    midnight.getUTCDate() !== day
  ) {
    return null;
  }
  return midnight.getTime();
}

function utcMidnightOf(date: string, caller: string): number {
  const midnight = utcMidnightOrNull(date);
  if (midnight == null) throw new RangeError(`${caller}: not a YYYY-MM-DD date: ${String(date)}`);
  return midnight;
}

/** True for a real calendar date written `YYYY-MM-DD`: `2026-11-19`, but not `2026-02-30` or `2026-2-3`. */
export function isLocalDate(value: unknown): value is string {
  return utcMidnightOrNull(value) != null;
}

/**
 * The instant of a Toronto date and minutes since midnight. A time that does not exist (the hour
 * skipped in spring) resolves 60 minutes later; a time that happens twice (the hour repeated in the
 * fall) resolves to its first occurrence, in EDT.
 * `fromLocal('2026-03-08', 150)` = 07:30Z (03:30 EDT); `fromLocal('2026-11-01', 90)` = 05:30Z.
 *
 * Minutes past 1439 run on into the next day by the wall clock, so `fromLocal(date, 1440)` is the next
 * midnight even on a 23- or 25-hour day. Throws a `RangeError` for a date that is not a real
 * `YYYY-MM-DD` date.
 */
export function fromLocal(date: string, minutes: number): number {
  if (!Number.isFinite(minutes)) throw new RangeError(`fromLocal: not a number of minutes: ${minutes}`);
  // The wall-clock reading as if it were UTC; the instant is this reading minus Toronto's offset.
  const wall = utcMidnightOf(date, 'fromLocal') + minutes * MINUTE_MS;
  const asEdt = wall - EDT_OFFSET_MINUTES * MINUTE_MS;
  const asEst = wall - EST_OFFSET_MINUTES * MINUTE_MS;
  // The EDT reading is right whenever daylight time is in force at that instant, which also picks the
  // first of the two 01:30s in the fall. Otherwise the EST reading is right, and for a reading inside
  // the hour skipped in spring it is exactly the instant 60 minutes later (02:30 → 03:30 EDT).
  return torontoOffsetMinutes(asEdt) === EDT_OFFSET_MINUTES ? asEdt : asEst;
}

/** The calendar date `days` after (or, when negative, before) a date: `('2026-11-19', 1)` → `2026-11-20`. */
export function addLocalDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`addLocalDays: not a whole number of days: ${days}`);
  // Counted on the calendar, not in hours: a Toronto day is 23 or 25 hours long twice a year.
  const shifted = new Date(utcMidnightOf(date, 'addLocalDays') + days * DAY_MS);
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The Toronto date of an instant, `YYYY-MM-DD`: what "today" means for store boards and payout runs. */
export function localDateOf(utcMs: number): string {
  return toLocal(utcMs).date;
}

/** The instant a Toronto date starts (local midnight). */
export function startOfLocalDay(date: string): number {
  return fromLocal(date, 0);
}

/** The weekday of a business date: `'2026-11-19'` → `'thu'`. Store hours are kept per weekday (§4.2). */
export function weekdayOf(date: string): Weekday {
  return WEEKDAY_BY_UTC_DAY[new Date(utcMidnightOf(date, 'weekdayOf')).getUTCDay()] ?? 'sun';
}

// ---------- clock times (`HH:MM`) ----------

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Minutes since midnight of a 24-hour clock time: `'06:30'` → 390. Null for anything that is not
 * `HH:MM` between 00:00 and 23:59. Store hours and cut-offs are stored in this form (§1.1).
 */
export function parseClock(clock: string): number | null {
  const match = typeof clock === 'string' ? CLOCK_PATTERN.exec(clock) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The reverse of `parseClock`: 390 → `'06:30'`. Throws a `RangeError` outside 0–1439: there is no
 * clock time to write, and wrapping around midnight would turn a wrong closing time into a valid one.
 */
export function toClock(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError(`toClock: not minutes of a day (0–1439): ${minutes}`);
  }
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

// ---------- display ----------
// Month and day names are written out in English here, never taken from the device locale. A missing
// value shows as a dash, like the other display helpers: a screen must not crash on a missing time.

const MISSING = '—';

/** Minutes since midnight on a 12-hour clock: 820 → 1:40 pm. Midnight and noon both read 12. */
function twelveHour(minutes: number): { hour: number; minute: number; meridiem: 'am' | 'pm' } {
  const hour24 = Math.floor(minutes / 60);
  return {
    hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: minutes % 60,
    meridiem: hour24 < 12 ? 'am' : 'pm',
  };
}

function clockText(minutes: number): string {
  const { hour, minute, meridiem } = twelveHour(minutes);
  return `${hour}:${pad2(minute)} ${meridiem}`;
}

/** "Today" or "Tomorrow" as seen from `now`; with no usable `now`, or for any other day, "Fri, Nov 20". */
function dayText(wall: WallClock, now: number | null | undefined): string {
  const today = now == null ? null : wallClockOrNull(now);
  if (today) {
    if (wall.date === today.date) return 'Today';
    if (wall.date === addLocalDays(today.date, 1)) return 'Tomorrow';
  }
  // No year: every time the product shows is within days of now (§4.4 horizon, §4.5 holds, §4.6 clocks).
  return `${WEEKDAY_SHORT_NAMES[wall.weekday]}, ${MONTH_SHORT_NAMES[wall.month - 1] ?? ''} ${wall.day}`;
}

function wallClockOfInput(value: TimeInput): WallClock | null {
  const millis = toMillis(value);
  return millis == null ? null : wallClockOrNull(millis);
}

/** The Toronto clock time of an instant as people read it: "1:40 pm", "7:00 am", "12:05 pm". */
export function formatClockET(value: TimeInput): string {
  const wall = wallClockOfInput(value);
  return wall ? clockText(wall.minutes) : MISSING;
}

/** A stored clock time as people read it: `'18:00'` → "6:00 pm" ("Closes 6:00 pm"). */
export function formatClockTime(clock: string): string {
  const minutes = parseClock(clock);
  return minutes == null ? MISSING : clockText(minutes);
}

/** The Toronto day of an instant, seen from `now`: "Today", "Tomorrow", otherwise "Fri, Nov 20". */
export function formatDayET(value: TimeInput, now: number): string {
  const wall = wallClockOfInput(value);
  return wall ? dayText(wall, now) : MISSING;
}

/**
 * A delivery window: "7–9 am", "11 am–1 pm". The meridiem is written once when both ends share it.
 * The day is not part of it; pair it with `formatDayET`.
 */
export function formatWindowET(start: TimeInput, end: TimeInput): string {
  const from = wallClockOfInput(start);
  const to = wallClockOfInput(end);
  if (!from || !to) return MISSING;
  const a = twelveHour(from.minutes);
  const b = twelveHour(to.minutes);
  // Slots start on the hour, so the minutes are written only when there are some: "7–9 am", "7:30–9:30 am".
  const hourText = (time: { hour: number; minute: number }) =>
    time.minute === 0 ? String(time.hour) : `${time.hour}:${pad2(time.minute)}`;
  return a.meridiem === b.meridiem
    ? `${hourText(a)}–${hourText(b)} ${b.meridiem}`
    : `${hourText(a)} ${a.meridiem}–${hourText(b)} ${b.meridiem}`;
}

/**
 * Day and clock time together: "Fri, Nov 20, 1:40 pm". With `now`, the day is written like
 * `formatDayET` does ("Today, 1:40 pm"); without it the date is always spelled out, which is what a
 * receipt or a printed pick slip needs.
 */
export function formatDateTimeET(value: TimeInput, now?: number | null): string {
  const wall = wallClockOfInput(value);
  return wall ? `${dayText(wall, now)}, ${clockText(wall.minutes)}` : MISSING;
}
