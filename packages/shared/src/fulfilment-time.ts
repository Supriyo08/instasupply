/**
 * When things happen (§4.2–§4.8): store hours and holidays, the ASAP promise ("Delivery by 1:50 pm"),
 * the 2-hour delivery windows, pickup ready and hold times, and the clocks that run on a store order,
 * a job offer and a quote.
 *
 * The customer app shows these times, the quote builder plans with them and the server checks the
 * chosen window again with the same functions, so all three must give the same answer (D14). Every
 * function is pure: instants are epoch milliseconds, `now` is always a parameter, and all calendar
 * work goes through `time-zone.ts` (Toronto time, no `Intl`).
 *
 * Loading minutes and driving speed come from the load's vehicle class (`VEHICLE_CLASSES`,
 * `driveMinutes`, §3.3).
 */
import { shortStoreName, type DayHours, type Store, type StoreStatus, type Weekday } from './catalog';
import { ONTARIO_HOLIDAYS, SUPPORT_HOURS } from './market';
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
  addLocalDays,
  formatClockET,
  formatClockTime,
  formatDateTimeET,
  formatDayET,
  formatWindowET,
  fromLocal,
  isLocalDate,
  localDateOf,
  parseClock,
  toLocal,
  toMillis,
  weekdayOf,
  type TimeInput,
} from './time-zone';
import { VEHICLE_CLASSES, driveMinutes, type VehicleClass } from './vehicles';

// ---------- constants (§4.2, §4.4, §4.6) ----------

/** Nothing is promised after 7 pm, Toronto time. */
export const LATEST_DROPOFF = '19:00';

/** Every delivery slot is 2 hours long. */
export const DELIVERY_SLOT_MINUTES = 120;

const WEEKDAY_SLOTS: readonly string[] = ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00'];

/**
 * Slot starts per weekday, as Toronto clock times. A window id is the date and the slot start,
 * `2026-11-20T07:00` (§4.7).
 */
export const DELIVERY_SLOTS: Record<Weekday, readonly string[]> = {
  mon: WEEKDAY_SLOTS,
  tue: WEEKDAY_SLOTS,
  wed: WEEKDAY_SLOTS,
  thu: WEEKDAY_SLOTS,
  fri: WEEKDAY_SLOTS,
  sat: ['08:00', '10:00', '12:00', '14:00'],
  sun: ['10:00', '12:00', '14:00'],
};

/** A store has 10 minutes to accept or reject: `respondBy = (open now ? now : next opening) + 10 min`. */
export const STORE_ACCEPT_SLA_MIN = 10;
/** The store is reminded (push and SMS to its alert phone) this long before `respondBy`. */
export const STORE_REMINDER_BEFORE_MIN = 5;
/** Staff are alerted at `respondBy`; the order is rejected (`no_response`) this long after it. */
export const STORE_AUTO_REJECT_AFTER_MIN = 20;
/** An ASAP pickup is never planned sooner than this: a driver has to be matched and get to the store. */
export const DISPATCH_BUFFER_MIN = 15;
/** The earliest scheduled slot starts this long from now. */
export const MIN_SCHEDULE_LEAD_MIN = 90;
/** Delivery can be scheduled for today and the next 6 days. */
export const SCHEDULE_DAYS = 7;
/** A job offer opens 12 hours before its target pickup, so drivers can plan the next morning. */
export const OFFER_LEAD_MIN = 720;
/** Staff hear about an open offer nobody has claimed after this long (once). */
export const JOB_UNCLAIMED_ALERT_MIN = 15;
/** A material list is answered within 30 minutes of support hours. */
export const QUOTE_SLA_MIN = 30;
/** How long staff can keep a quote open for the customer. */
export const QUOTE_VALID_HOURS = [24, 48, 72] as const;
export type QuoteValidHours = (typeof QUOTE_VALID_HOURS)[number];
export const DEFAULT_QUOTE_VALID_HOURS: QuoteValidHours = 48;
/** Staff aim to resolve an issue this long after it is reported (support hours are not applied in v1). */
export const ISSUE_SLA_HOURS = 4;
/**
 * A card authorization is captured at the latest 6 days after it was made:
 * `min(authorizedAt + 6 days, the gateway's captureBefore − 6 h)` (§3.8).
 */
export const CAPTURE_DEADLINE_DAYS = 6;
// `ISSUE_WINDOW_HOURS` (48) is the last constant of the §4.6 table. It is declared once, in issues.ts.

// Three figures the rules use without naming them in the §4.6 table. They stay private to this file.
/** A scheduled order is ready 15 minutes before the driver's target pickup (§4.4 `readyBy`). */
const READY_BEFORE_PICKUP_MIN = 15;
/** A pickup order is promised for today only if it is ready 15 minutes before closing (§4.5). */
const PICKUP_BEFORE_CLOSE_MIN = 15;
/** How far ahead the next opening and the end of a pickup hold are looked for (§4.2). */
const OPENING_SEARCH_DAYS = 14;

const MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * MINUTE_MS;
const ASAP_WINDOW_ID = 'asap';
const MISSING = '—';

// ---------- inputs and results ----------

/**
 * The part of a store that says when it is open: one interval per weekday plus its own closed dates.
 * The platform holidays (`ONTARIO_HOLIDAYS`) always apply on top. Support hours fit the same shape:
 * `{ hours: SUPPORT_HOURS, closures: [] }`.
 */
export type HoursSchedule = Pick<Store, 'hours' | 'closures'>;

/** Everything the timing rules read from a store document. */
export type TimingStore = Pick<
  Store,
  | 'name'
  | 'status'
  | 'acceptingOrders'
  | 'fulfilment'
  | 'hours'
  | 'closures'
  | 'prepMinutes'
  | 'sameDayCutoff'
>;

/** A store's opening interval on one Toronto date, as clock times and as instants. */
export interface StoreDayHours extends DayHours {
  /** `YYYY-MM-DD`. */
  date: string;
  openAt: number;
  closeAt: number;
}

/** The trip from a store to the jobsite, as far as time is concerned. */
export interface TripInput {
  /** The class the load needs (`PricedStore.vehicleClass`): it sets loading minutes and driving speed. */
  vehicleClass: VehicleClass;
  /** Road distance store → jobsite in tenths of a km (`PricedStore.roadTenths`). */
  roadTenths: number;
}

/** One store's part of a delivery order. */
export interface WindowStoreInput extends TripInput {
  storeId: string;
  store: TimingStore;
}

/** When one store order must be ready, picked up and delivered. `StoreOrder.timing` is built from it. */
export interface StoreTiming {
  storeId: string;
  readyBy: number;
  targetPickupAt: number;
  deliverBy: number;
}

/** One store's ASAP promise, or the first reason it cannot make one ("Same-day cut-off was 3:00 pm"). */
export type StorePromise = { ok: true; timing: StoreTiming } | { ok: false; storeId: string; reason: string };

interface WindowBase {
  /** `asap`, or the slot start as a Toronto time: `2026-11-20T07:00`. */
  id: string;
  kind: 'asap' | 'scheduled';
  /** Toronto date, `YYYY-MM-DD`. */
  date: string;
  /** The slot start; null for ASAP. */
  startAt: number | null;
  /**
   * "Today by 1:50 pm" for ASAP ("ASAP" while it cannot be promised); the day and the slot for a
   * scheduled window, "Tomorrow, 7–9 am".
   */
  label: string;
}

/** A window the order can be placed for. The server stores it as a `DeliveryWindow` plus each store's timing. */
export interface AvailableWindow extends WindowBase {
  available: true;
  /** Deliver by: the slot end, or for ASAP the latest promise among the stores. */
  endAt: number;
  reason: null;
  /** One entry per store of the order, in the order they were passed in. */
  stores: StoreTiming[];
}

/** A window that is shown greyed out with the reason, so the customer sees why it cannot be chosen. */
export interface UnavailableWindow extends WindowBase {
  available: false;
  /** The slot end; null for ASAP, which has no promise when it is not available. */
  endAt: number | null;
  /** "Too soon — earliest 2:00 pm", "Kestrel and Bluestone are closed Sunday", "Bluestone closes at 1:00 pm Saturday". */
  reason: string;
  /** Always empty. */
  stores: StoreTiming[];
}

/**
 * One row of the window picker. It is plain data (numbers and strings), so it is also what
 * `WINDOW_UNAVAILABLE` sends back in `details.windows` (§4.7).
 */
export type WindowOption = AvailableWindow | UnavailableWindow;

/** When a pickup order placed now would be ready, and how long the store would hold it. */
export type PickupPromise =
  | {
      ok: true;
      readyAt: number;
      /** Null only when the store has no open day in the 14 days after `readyAt`. */
      holdUntil: number | null;
      /** "Ready in 15 min", "Ready tomorrow 7:15 am", "Ready Mon 7:15 am". */
      label: string;
    }
  | { ok: false; reason: string };

/** What a store card says about a store right now (§2.8, §7.3). */
export interface StoreAvailability {
  /** Inside its opening hours at `now`. Always false for a store that is not live. */
  openNow: boolean;
  /** The next opening when it is closed now; null when it is open or does not open in the next 14 days. */
  opensAt: number | null;
  /** Today's closing time when it is open now ("Closes 6:00 pm"); otherwise null. */
  closesAt: number | null;
  /**
   * "Onboarding now", "Coming soon", "Paused" or "Closed · opens 7:00 am" ("Closed · opens tomorrow
   * 6:30 am" when that is another day); null when there is nothing to flag.
   */
  badge: string | null;
  /**
   * The promise line: "Delivery by 1:50 pm", else "Pickup ready in 25 min", else "Opens tomorrow
   * 6:30 am"; "Joining InstaSupply" for a store that is not live. Null when there is nothing to promise
   * (the store has paused new orders).
   */
  promise: string | null;
  /** The ASAP deliver-by time when the store can deliver to the site today; else null. */
  deliverBy: number | null;
  /** When a pickup order placed now would be ready; null when the store does not offer pickup or cannot take orders. */
  pickupReadyAt: number | null;
}

// ---------- wording ----------

/** "Kestrel", "Kestrel and Bluestone", "Kestrel, Bluestone and Aircrest". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * A time seen from `now`, for the end of a sentence: "7:15 am" today, "tomorrow 7:15 am", "Mon 7:15 am"
 * in the coming week (§4.5 "Ready Mon 7:15 am"). Further away a weekday alone would be ambiguous, so
 * the date is written: "Mon, Nov 30, 7:15 am".
 */
function whenPhrase(at: number, now: number): string {
  const day = toLocal(at);
  const today = localDateOf(now);
  const clock = formatClockET(at);
  if (day.date === today) return clock;
  if (day.date === addLocalDays(today, 1)) return `tomorrow ${clock}`;
  // Up to 6 days ahead a weekday names one day only; the 7th day has today's name again.
  // (`YYYY-MM-DD` dates sort like the calendar.)
  if (day.date > today && day.date <= addLocalDays(today, 6)) {
    return `${WEEKDAY_SHORT_NAMES[day.weekday]} ${clock}`;
  }
  return formatDateTimeET(at);
}

/**
 * Why no new order can go to this store at all, whatever the time; null when one can. A store must be
 * live, must not have paused new orders, and must offer the fulfilment (§4.3 step 1, §2.8).
 */
function orderBlockReason(store: TimingStore, fulfilment: 'delivery' | 'pickup'): string | null {
  const name = shortStoreName(store.name);
  if (store.status !== 'live') return `${name} isn't taking orders`;
  if (!store.acceptingOrders) return `${name} has paused new orders`;
  // Every promise is counted from the prep time. A store document without a usable one gets no
  // promise at all: a time of `NaN` must never reach an order.
  if (!Number.isFinite(store.prepMinutes) || store.prepMinutes < 0) return `${name} isn't taking orders`;
  if (fulfilment === 'delivery' && !store.fulfilment.delivery) return `${name} doesn't deliver`;
  if (fulfilment === 'pickup' && !store.fulfilment.pickup) return `${name} doesn't offer pickup`;
  return null;
}

/**
 * Why nothing can be delivered from this store on `today` any more ("Same-day cut-off was 3:00 pm");
 * null while `now` is before its cut-off (§4.3 step 1, §4.4).
 */
function cutoffReason(store: TimingStore, today: string, now: number): string | null {
  const cutoff = parseClock(store.sameDayCutoff);
  // A cut-off that cannot be read promises nothing for today, rather than everything.
  if (cutoff == null) return `${shortStoreName(store.name)} has no same-day delivery`;
  return now < fromLocal(today, cutoff)
    ? null
    : `Same-day cut-off was ${formatClockTime(store.sameDayCutoff)}`;
}

// ---------- store hours (§4.2) ----------

/** An instant rounded up to the next 5 minutes: promises are never "1:37 pm". */
export function roundUp5(ms: number): number {
  return Math.ceil(ms / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

/**
 * The store's opening interval on a Toronto date, or null when it is closed that day: no hours for the
 * weekday, one of its own `closures`, or a platform holiday (`ONTARIO_HOLIDAYS`).
 */
export function storeHoursOn(store: HoursSchedule, date: string): StoreDayHours | null {
  return hoursOn(store, date, ONTARIO_HOLIDAYS);
}

/**
 * `storeHoursOn` with the platform-wide closed dates passed in: the holidays close fulfilment (§4.2),
 * while support keeps `SUPPORT_HOURS` on them (§4.6 names no holiday for the quote clock).
 */
function hoursOn(store: HoursSchedule, date: string, holidays: readonly string[]): StoreDayHours | null {
  if (!isLocalDate(date)) return null;
  if (holidays.includes(date) || store.closures.includes(date)) return null;
  const hours = store.hours[weekdayOf(date)];
  if (!hours) return null;
  const open = parseClock(hours.open);
  const close = parseClock(hours.close);
  // Hours that cannot be read count as closed: a bad store document must never turn into a promise.
  if (open == null || close == null) return null;
  const openAt = fromLocal(date, open);
  const closeAt = fromLocal(date, close);
  // The day must close after it opens: there are no overnight hours (§4.2). The instants are compared
  // rather than the clock times, because on the night the clocks go forward an opening time inside the
  // skipped hour moves 60 minutes later (§4.1), which leaves nothing of an interval such as 02:30–03:15.
  if (closeAt <= openAt) return null;
  return { open: hours.open, close: hours.close, date, openAt, closeAt };
}

/** The opening interval the store is inside at `ms`; null when it is closed then. */
function openIntervalAt(
  store: HoursSchedule,
  ms: number,
  holidays: readonly string[] = ONTARIO_HOLIDAYS,
): StoreDayHours | null {
  const hours = hoursOn(store, localDateOf(ms), holidays);
  return hours && ms >= hours.openAt && ms < hours.closeAt ? hours : null;
}

/** True from the opening time up to, but not including, the closing time of an open day. */
export function isStoreOpenAt(store: HoursSchedule, ms: number): boolean {
  return openIntervalAt(store, ms) != null;
}

/**
 * The first opening time after `ms`, looking at that day and the 14 days after it; null when there is
 * none. For a store that is open at `ms` this is the next day it opens, which is what the pickup rule
 * needs when today's remaining hours are too short (§4.5).
 */
export function nextOpeningAt(store: HoursSchedule, ms: number): number | null {
  return openingAfter(store, ms, ONTARIO_HOLIDAYS);
}

function openingAfter(store: HoursSchedule, ms: number, holidays: readonly string[]): number | null {
  const today = localDateOf(ms);
  for (let day = 0; day <= OPENING_SEARCH_DAYS; day++) {
    const hours = hoursOn(store, addLocalDays(today, day), holidays);
    if (hours && hours.openAt > ms) return hours.openAt;
  }
  return null;
}

// ---------- ASAP (§4.3) ----------

type AsapPlan =
  { ok: true; readyBy: number; targetPickupAt: number; deliverBy: number } | { ok: false; reason: string };

/** The four steps of §4.3 for one store, in the order the spec lists them: the first rule that fails is the reason. */
function planAsap(store: TimingStore, trip: TripInput, now: number): AsapPlan {
  const fail = (reason: string): AsapPlan => ({ ok: false, reason });
  const name = shortStoreName(store.name);

  // Step 1: live, accepting, offers delivery, open now, before the same-day cut-off.
  const blocked = orderBlockReason(store, 'delivery');
  if (blocked) return fail(blocked);
  const today = localDateOf(now);
  const hours = openIntervalAt(store, now);
  if (!hours) return fail(`${name} is closed right now`);
  const pastCutoff = cutoffReason(store, today, now);
  if (pastCutoff) return fail(pastCutoff);

  const driveMs = driveMinutes(trip.vehicleClass, trip.roadTenths) * MINUTE_MS;
  const loadMs = VEHICLE_CLASSES[trip.vehicleClass].loadMinutes * MINUTE_MS;

  // Step 2: matching a driver and their way to the store overlap the preparation, but take 15 minutes
  // at least; the load must be on the truck before the store closes.
  const pickupAt = now + Math.max(store.prepMinutes, DISPATCH_BUFFER_MIN) * MINUTE_MS;
  if (pickupAt + loadMs > hours.closeAt) return fail(`${name} closes at ${formatClockTime(hours.close)}`);

  // Step 3: 7 pm today is the last promise. A time after midnight is after it too, so this one
  // comparison is also the "same local date" rule.
  const deliverBy = roundUp5(pickupAt + loadMs + driveMs);
  const latest = parseClock(LATEST_DROPOFF);
  if (latest == null || deliverBy > fromLocal(today, latest)) {
    return fail(`Too late to deliver today — deliveries end at ${formatClockTime(LATEST_DROPOFF)}`);
  }

  // Step 4.
  return { ok: true, readyBy: now + store.prepMinutes * MINUTE_MS, targetPickupAt: pickupAt, deliverBy };
}

/**
 * One store's ASAP promise. It holds when the store is live, accepting orders, offers delivery, is open
 * now and `now` is before its same-day cut-off; the pickup (`now + max(prepMinutes, 15)`) plus loading
 * ends before closing; and `deliverBy = roundUp5(pickup + loading + driving)` is still today and not
 * after 7 pm. Then `readyBy = now + prepMinutes` and `targetPickupAt` is the pickup. Otherwise the
 * first failing rule is the reason. Store cards call it with the cart's class for the store, or
 * `pickup` when there is none.
 *
 * Thu 12:25, Kestrel (prep 25, 26.0 km, pickup class): pickup 12:50, drive 42 min → by 1:50 pm.
 */
export function asapPromise(input: WindowStoreInput, now: number): StorePromise {
  const { storeId } = input;
  const plan = planAsap(input.store, input, now);
  if (!plan.ok) return { ok: false, storeId, reason: plan.reason };
  const { readyBy, targetPickupAt, deliverBy } = plan;
  return { ok: true, timing: { storeId, readyBy, targetPickupAt, deliverBy } };
}

/**
 * The ASAP option of an order: available only when every store can promise ASAP. `endAt` is the latest
 * `deliverBy` among them and the label is "Today by 1:50 pm"; `stores` carries each store's own
 * promise ("Bluestone · by 1:40 pm"). Otherwise it is unavailable with the first failing reason. An
 * order with no stores has no ASAP promise.
 */
export function asapWindow(stores: readonly WindowStoreInput[], now: number): WindowOption {
  const base = { id: ASAP_WINDOW_ID, kind: 'asap', date: localDateOf(now), startAt: null } as const;
  const unavailable = (reason: string): UnavailableWindow => ({
    ...base,
    label: 'ASAP',
    available: false,
    endAt: null,
    reason,
    stores: [],
  });
  // ASAP is a promise made by stores. A re-attempt, whose load is already on the truck, is scheduled.
  if (stores.length === 0) return unavailable('ASAP is not available for this order');

  const timings: StoreTiming[] = [];
  for (const input of stores) {
    const promise = asapPromise(input, now);
    if (!promise.ok) return unavailable(promise.reason);
    timings.push(promise.timing);
  }
  // The order is complete when its last store has delivered.
  const endAt = Math.max(...timings.map((timing) => timing.deliverBy));
  return {
    ...base,
    label: windowLabel({ kind: 'asap', startAt: null, endAt }, now),
    available: true,
    endAt,
    reason: null,
    stores: timings,
  };
}

// ---------- scheduled windows (§4.4, §4.7) ----------

interface Slot {
  /** `YYYY-MM-DDTHH:MM`, the slot start as a Toronto time. */
  id: string;
  date: string;
  startAt: number;
  endAt: number;
}

/** The delivery slots of one Toronto date, in time order. */
function slotsOn(date: string): Slot[] {
  const slots: Slot[] = [];
  for (const clock of DELIVERY_SLOTS[weekdayOf(date)]) {
    const start = parseClock(clock);
    if (start == null) continue;
    slots.push({
      id: `${date}T${clock}`,
      date,
      startAt: fromLocal(date, start),
      endAt: fromLocal(date, start + DELIVERY_SLOT_MINUTES),
    });
  }
  return slots;
}

type SlotPlan = { ok: true; stores: StoreTiming[] } | { ok: false; reason: string };

/**
 * One slot for every store of the order (§4.4). The rules are checked in the spec's order, each across
 * all stores before the next one, so the reason names what the customer should know first: every store
 * that is closed that day, then the lead time, then the cut-off, then the first store whose hours do
 * not fit.
 */
function planSlot(slot: Slot, stores: readonly WindowStoreInput[], now: number): SlotPlan {
  const fail = (reason: string): SlotPlan => ({ ok: false, reason });

  // Nothing is delivered on a platform holiday (§4.2), with or without stores in the order.
  if (ONTARIO_HOLIDAYS.includes(slot.date)) return fail('Holiday — no deliveries');

  // §4.4 leaves these to pricing, which blocks the order. They are checked here as well, like for
  // ASAP, so that no window is offered for a store that cannot take the order.
  for (const { store } of stores) {
    const blocked = orderBlockReason(store, 'delivery');
    if (blocked) return fail(blocked);
  }

  // Rule 1: every store has hours on that date.
  const dayName = WEEKDAY_NAMES[weekdayOf(slot.date)];
  const open: { input: WindowStoreInput; hours: StoreDayHours }[] = [];
  const closed: string[] = [];
  for (const input of stores) {
    const hours = storeHoursOn(input.store, slot.date);
    if (hours) open.push({ input, hours });
    else closed.push(shortStoreName(input.store.name));
  }
  if (closed.length > 0) {
    return fail(`${joinNames(closed)} ${closed.length === 1 ? 'is' : 'are'} closed ${dayName}`);
  }

  // Rule 2: the slot starts at least 90 minutes from now. A slot that has already begun gets its own
  // wording: "too soon" would be wrong for this morning's window.
  if (slot.startAt <= now) return fail('No longer available');
  const earliestStart = now + MIN_SCHEDULE_LEAD_MIN * MINUTE_MS;
  if (slot.startAt < earliestStart) {
    return fail(`Too soon — earliest ${formatClockET(roundUp5(earliestStart))}`);
  }

  // Rule 3: for today, every store is still before its same-day cut-off.
  const isToday = slot.date === localDateOf(now);
  if (isToday) {
    for (const { input } of open) {
      const pastCutoff = cutoffReason(input.store, slot.date, now);
      if (pastCutoff) return fail(pastCutoff);
    }
  }

  // Rule 4: `earliest ≤ latest`, then the times of each store order.
  const timings: StoreTiming[] = [];
  for (const { input, hours } of open) {
    const { store } = input;
    const name = shortStoreName(store.name);
    const driveMs = driveMinutes(input.vehicleClass, input.roadTenths) * MINUTE_MS;
    const loadMs = VEHICLE_CLASSES[input.vehicleClass].loadMinutes * MINUTE_MS;
    // An order for a later day is staged before opening; today the store still needs its prep time.
    const earliest = isToday ? Math.max(hours.openAt, now + store.prepMinutes * MINUTE_MS) : hours.openAt;
    // Loading must end before the store closes, and the drive must end before the window does.
    const beforeClosing = hours.closeAt - loadMs;
    const beforeWindowEnd = slot.endAt - loadMs - driveMs;
    const latest = Math.min(beforeClosing, beforeWindowEnd);
    if (earliest > latest) {
      if (beforeClosing < earliest) {
        return fail(`${name} closes at ${formatClockTime(hours.close)} ${dayName}`);
      }
      // The closing time is fine; the load just cannot reach the site before the window ends, either
      // because the store opens too late for it or because today's prep time runs too long.
      if (earliest === hours.openAt) {
        return fail(`${name} opens at ${formatClockTime(hours.open)} ${dayName}`);
      }
      return fail(`${name} can't have it ready in time`);
    }
    // Aim to arrive as the window opens, as far as the store's hours allow.
    const targetPickupAt = Math.min(Math.max(slot.startAt - loadMs - driveMs, earliest), latest);
    const readyBy = Math.max(earliest, targetPickupAt - READY_BEFORE_PICKUP_MIN * MINUTE_MS);
    timings.push({ storeId: input.storeId, readyBy, targetPickupAt, deliverBy: slot.endAt });
  }
  return { ok: true, stores: timings };
}

function slotOption(slot: Slot, stores: readonly WindowStoreInput[], now: number): WindowOption {
  const base = {
    id: slot.id,
    kind: 'scheduled',
    date: slot.date,
    startAt: slot.startAt,
    label: windowLabel({ kind: 'scheduled', startAt: slot.startAt, endAt: slot.endAt }, now),
  } as const;
  const plan = planSlot(slot, stores, now);
  return plan.ok
    ? { ...base, available: true, endAt: slot.endAt, reason: null, stores: plan.stores }
    : { ...base, available: false, endAt: slot.endAt, reason: plan.reason, stores: [] };
}

/**
 * Every slot of today and the next 6 days, in time order, available or not. A slot `[ws, we]` on date
 * `d` works for a store when the store has hours on `d`, `ws ≥ now + 90 min`, for today `now` is before
 * the same-day cut-off, and `earliest ≤ latest`, where `earliest` is the opening time (today:
 * `max(open, now + prep)`) and `latest = min(close − loading, we − loading − driving)`. Then
 * `targetPickupAt = clamp(ws − loading − driving, earliest, latest)`,
 * `readyBy = max(earliest, targetPickupAt − 15 min)` and `deliverBy = we`.
 *
 * A slot is available only when it works for every store of the order; the others stay in the list
 * with the reason. With no stores only the calendar and the clock decide: every slot that is not on a
 * holiday and starts at least 90 minutes from now is available. A re-attempt of a failed delivery,
 * whose load is already on the truck, picks its new window that way.
 *
 * Kestrel and Bluestone, asked Thu 15:10: Fri 07–09 → pickup 06:30 at both; Fri 09–11 → 08:03 and
 * 08:08; Sat 14–16 → 13:03 and 12:45; no Sunday slot.
 */
export function scheduledWindows(stores: readonly WindowStoreInput[], now: number): WindowOption[] {
  const today = localDateOf(now);
  const options: WindowOption[] = [];
  for (let day = 0; day < SCHEDULE_DAYS; day++) {
    for (const slot of slotsOn(addLocalDays(today, day))) options.push(slotOption(slot, stores, now));
  }
  return options;
}

const SLOT_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/**
 * True for `asap` and for anything shaped like a slot id, `YYYY-MM-DDTHH:MM` with a real date and
 * clock time. It checks the form only; `resolveWindow` says whether the window can be used.
 */
export function isWindowId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === ASAP_WINDOW_ID) return true;
  const match = SLOT_ID_PATTERN.exec(value);
  return match != null && isLocalDate(match[1]) && parseClock(match[2] ?? '') != null;
}

/**
 * The window a customer chose, checked again at `now`: exactly the option `asapWindow` or
 * `scheduledWindows` would list under that id, available or not. Null when the id is not `asap` and
 * not a slot of the next 7 days. `placeOrder` and `acceptQuote` refuse anything but an available
 * window with `WINDOW_UNAVAILABLE` (§4.7).
 */
export function resolveWindow(
  windowId: string,
  stores: readonly WindowStoreInput[],
  now: number,
): WindowOption | null {
  if (windowId === ASAP_WINDOW_ID) return asapWindow(stores, now);
  if (!isWindowId(windowId)) return null;
  const date = windowId.slice(0, 10);
  const today = localDateOf(now);
  // `YYYY-MM-DD` dates sort like the calendar, so the horizon is a plain comparison.
  if (date < today || date > addLocalDays(today, SCHEDULE_DAYS - 1)) return null;
  const slot = slotsOn(date).find((candidate) => candidate.id === windowId);
  return slot ? slotOption(slot, stores, now) : null;
}

/**
 * ASAP when it is available, otherwise the first available slot; null when the next 7 days have none.
 * Replacement orders, "Reorder & checkout" and the seed use it.
 */
export function earliestWindow(stores: readonly WindowStoreInput[], now: number): AvailableWindow | null {
  const asap = asapWindow(stores, now);
  if (asap.available) return asap;
  for (const option of scheduledWindows(stores, now)) {
    if (option.available) return option;
  }
  return null;
}

/**
 * The label of a window as it reads at `now`: "Today by 1:50 pm" for ASAP, the day and the slot for a
 * scheduled window ("Tomorrow, 7–9 am", "Sat, Nov 21, 8–10 am"). Stored labels go stale ("Today" is
 * wrong tomorrow), so screens that show an old order or a job card build the label again from the
 * window's instants.
 */
export function windowLabel(
  window: { kind: 'asap' | 'scheduled'; startAt: TimeInput; endAt: TimeInput },
  now: number,
): string {
  const end = toMillis(window.endAt);
  if (end == null) return MISSING;
  const start = toMillis(window.startAt);
  if (window.kind === 'scheduled' && start != null) {
    return `${formatDayET(start, now)}, ${formatWindowET(start, end)}`;
  }
  return `${formatDayET(end, now)} by ${formatClockET(end)}`;
}

// ---------- pickup (§4.5) ----------

type PickupPlan =
  | {
      ok: true;
      readyAt: number;
      /** "in 15 min", "tomorrow 7:15 am", "Mon 7:15 am": what follows "Ready" on a label. */
      when: string;
    }
  | { ok: false; reason: string };

function planPickup(store: TimingStore, now: number): PickupPlan {
  const blocked = orderBlockReason(store, 'pickup');
  if (blocked) return { ok: false, reason: blocked };
  const prepMs = store.prepMinutes * MINUTE_MS;

  // Ready today only if the customer still has 15 minutes to collect before the store closes.
  const hours = openIntervalAt(store, now);
  if (hours && now + prepMs <= hours.closeAt - PICKUP_BEFORE_CLOSE_MIN * MINUTE_MS) {
    const readyAt = roundUp5(now + prepMs);
    return { ok: true, readyAt, when: `in ${Math.ceil((readyAt - now) / MINUTE_MS)} min` };
  }

  // Otherwise the store prepares it first thing after it next opens. There is no cut-off for pickup.
  const opening = nextOpeningAt(store, now);
  if (opening == null) {
    return {
      ok: false,
      reason: `${shortStoreName(store.name)} has no opening hours in the next ${OPENING_SEARCH_DAYS} days`,
    };
  }
  const readyAt = roundUp5(opening + prepMs);
  return { ok: true, readyAt, when: whenPhrase(readyAt, now) };
}

/**
 * When an order for pickup placed now would be ready. If the store is open and
 * `now + prep ≤ close − 15 min`: `roundUp5(now + prep)`; otherwise `roundUp5(next opening + prep)`.
 * There is no cut-off for pickup. `holdUntil` is `pickupHoldUntil` of that time. Not ok when the store
 * is not live, has paused orders, does not offer pickup or does not open in the next 14 days.
 *
 * Copperline (prep 15, Mon–Fri 07:00–17:00): Thu 12:25 → 12:40, "Ready in 15 min", held until Fri
 * 5:00 pm; Thu 16:50 → Fri 7:15 am, held until Sat 2:00 pm.
 */
export function pickupReady(store: TimingStore, now: number): PickupPromise {
  const plan = planPickup(store, now);
  if (!plan.ok) return plan;
  const { readyAt } = plan;
  return { ok: true, readyAt, holdUntil: pickupHoldUntil(store, readyAt), label: `Ready ${plan.when}` };
}

/**
 * How long the store keeps a ready pickup order: until closing time of its first open day strictly
 * after the Toronto date of `readyAt`. After that the order is cancelled and not charged. The store
 * order's real `holdUntil` is computed from the moment the store marks it ready.
 */
export function pickupHoldUntil(store: HoursSchedule, readyAt: number): number | null {
  const readyDate = localDateOf(readyAt);
  for (let day = 1; day <= OPENING_SEARCH_DAYS; day++) {
    const hours = storeHoursOn(store, addLocalDays(readyDate, day));
    if (hours) return hours.closeAt;
  }
  return null;
}

// ---------- clocks on a store order, a job offer and a quote (§4.6) ----------

/** `(open now ? now : next opening) + minutes`. With no opening in sight the clock simply starts now. */
function dueAfterOpening(
  schedule: HoursSchedule,
  now: number,
  minutes: number,
  holidays: readonly string[] = ONTARIO_HOLIDAYS,
): number {
  const open = openIntervalAt(schedule, now, holidays) != null;
  const from = open ? now : (openingAfter(schedule, now, holidays) ?? now);
  return from + minutes * MINUTE_MS;
}

/**
 * When the store must have accepted or rejected a new order: 10 minutes from `now` when it is open,
 * otherwise 10 minutes after its next opening. When no opening is found in 14 days it counts from `now`.
 */
export function storeRespondBy(store: HoursSchedule, now: number): number {
  return dueAfterOpening(store, now, STORE_ACCEPT_SLA_MIN);
}

/**
 * When a job offer becomes visible to drivers: 12 hours before the target pickup, but not before the
 * store accepted the order, `max(acceptedAt, targetPickupAt − 12 h)`. An ASAP job opens at acceptance.
 */
export function offerOpensAt(targetPickupAt: number, acceptedAt: number): number {
  return Math.max(acceptedAt, targetPickupAt - OFFER_LEAD_MIN * MINUTE_MS);
}

/**
 * When staff must have answered a material list: 30 minutes from `now` inside support hours, otherwise
 * 30 minutes after support next opens (§4.6). Only `SUPPORT_HOURS` count: the platform holidays close
 * fulfilment (§4.2), and the spec does not close support on them.
 */
export function quoteRespondBy(now: number): number {
  return dueAfterOpening({ hours: SUPPORT_HOURS, closures: [] }, now, QUOTE_SLA_MIN, []);
}

// ---------- store cards (§2.8, §7.3) ----------

/**
 * Badge and promise of a store that is not live (§2.8). A store ops closed for good is not "joining":
 * it shows "Closed" and promises nothing (the store list hides it anyway, §7.3).
 */
function notLiveCard(status: Exclude<StoreStatus, 'live'>): Pick<StoreAvailability, 'badge' | 'promise'> {
  switch (status) {
    case 'onboarding':
      return { badge: 'Onboarding now', promise: 'Joining InstaSupply' };
    case 'coming_soon':
      return { badge: 'Coming soon', promise: 'Joining InstaSupply' };
    case 'closed':
      return { badge: 'Closed', promise: null };
  }
}

/**
 * Badge, promise and the times behind them for a store card, the store page and Home. `trip` is the
 * way from the store to the customer's current site, with the cart's vehicle class for that store or
 * `pickup` by default; pass null when the site is not known, and the card promises pickup only.
 * A delivery is promised only inside the store's delivery radius.
 *
 * The promise is the best thing the store can do right now: an ASAP delivery, else (while it is open)
 * a pickup, else its next opening.
 */
export function storeAvailability(
  store: TimingStore,
  trip: TripInput | null,
  now: number,
): StoreAvailability {
  const nothing: StoreAvailability = {
    openNow: false,
    opensAt: null,
    closesAt: null,
    badge: null,
    promise: null,
    deliverBy: null,
    pickupReadyAt: null,
  };
  // Only a live store can be ordered from; the others have no hours worth showing yet (§2.8).
  if (store.status !== 'live') return { ...nothing, ...notLiveCard(store.status) };

  const open = openIntervalAt(store, now);
  const opensAt = open ? null : nextOpeningAt(store, now);
  const hoursPart = { openNow: open != null, opensAt, closesAt: open ? open.closeAt : null };
  // "Pause new orders" keeps the store listed with its hours, but there is nothing to promise.
  if (!store.acceptingOrders) return { ...nothing, ...hoursPart, badge: 'Paused' };

  // Out of range by the same test as pricing's `out_of_range`: road km beyond the store's radius (§3.4).
  const inRange = trip != null && trip.roadTenths / 10 <= store.fulfilment.deliveryRadiusKm;
  const asap = trip != null && inRange ? planAsap(store, trip, now) : null;
  const deliverBy = asap?.ok ? asap.deliverBy : null;
  const pickup = planPickup(store, now);

  let promise: string | null = null;
  if (deliverBy != null) promise = `Delivery by ${formatClockET(deliverBy)}`;
  else if (open && pickup.ok) promise = `Pickup ready ${pickup.when}`;
  else if (opensAt != null) promise = `Opens ${whenPhrase(opensAt, now)}`;

  let badge: string | null = null;
  if (!open) badge = opensAt == null ? 'Closed' : `Closed · opens ${whenPhrase(opensAt, now)}`;

  return { ...hoursPart, badge, promise, deliverBy, pickupReadyAt: pickup.ok ? pickup.readyAt : null };
}
