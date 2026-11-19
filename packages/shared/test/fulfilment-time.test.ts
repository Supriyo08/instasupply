/**
 * Fulfilment times (§4.2–§4.8): store hours, the ASAP promise, the 2-hour windows, pickup ready and
 * hold times, and the clocks on a store order, a job offer and a quote. The fixtures are the seed
 * stores of §11.3 and the worked examples are those of §4.8 (Thu 2026-11-19, EST), to the minute.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DayHours, Weekday } from '../src/catalog';
import * as fulfilmentTime from '../src/fulfilment-time';
import {
  CAPTURE_DEADLINE_DAYS,
  DEFAULT_QUOTE_VALID_HOURS,
  DELIVERY_SLOTS,
  DELIVERY_SLOT_MINUTES,
  DISPATCH_BUFFER_MIN,
  ISSUE_SLA_HOURS,
  JOB_UNCLAIMED_ALERT_MIN,
  LATEST_DROPOFF,
  MIN_SCHEDULE_LEAD_MIN,
  OFFER_LEAD_MIN,
  QUOTE_SLA_MIN,
  QUOTE_VALID_HOURS,
  SCHEDULE_DAYS,
  STORE_ACCEPT_SLA_MIN,
  STORE_AUTO_REJECT_AFTER_MIN,
  STORE_REMINDER_BEFORE_MIN,
  asapPromise,
  asapWindow,
  earliestWindow,
  isStoreOpenAt,
  isWindowId,
  nextOpeningAt,
  offerOpensAt,
  pickupHoldUntil,
  pickupReady,
  quoteRespondBy,
  resolveWindow,
  roundUp5,
  scheduledWindows,
  storeAvailability,
  storeHoursOn,
  storeRespondBy,
  windowLabel,
  type AvailableWindow,
  type StoreTiming,
  type TimingStore,
  type WindowOption,
  type WindowStoreInput,
} from '../src/fulfilment-time';
import { ONTARIO_HOLIDAYS, SUPPORT_HOURS } from '../src/market';
import {
  addLocalDays,
  formatClockET,
  fromLocal,
  localDateOf,
  parseClock,
  toClock,
  toLocal,
  weekdayOf,
} from '../src/time-zone';
import { VEHICLE_CLASSES, type VehicleClass } from '../src/vehicles';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// ---------- helpers ----------

/** The instant of a Toronto date and clock time: `at('2026-11-19', '12:25')`. */
function at(date: string, clock: string): number {
  const minutes = parseClock(clock);
  assert.ok(minutes !== null, `bad clock in a test: ${clock}`);
  return fromLocal(date, minutes);
}

/** An instant as the Toronto wall clock reads it, `2026-11-19 12:25`, so a failure is readable. */
function stamp(ms: number | null): string {
  if (ms === null) return 'null';
  const local = toLocal(ms);
  return `${local.date} ${toClock(local.minutes)}`;
}

/** Exact comparison of two instants (to the millisecond), reported in Toronto time. */
function sameInstant(actual: number | null, expected: number, what = ''): void {
  assert.equal(actual, expected, `${what} ${stamp(actual)} is not ${stamp(expected)}`.trim());
}

/** A deterministic PRNG, so a failing random case can be replayed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixtures are frozen: a function that changed its input would throw. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

type Interval = `${string}-${string}` | null;

function day(interval: Interval): DayHours | null {
  if (interval === null) return null;
  const [open = '', close = ''] = interval.split('-');
  return { open, close };
}

/** Store hours the way §11.3 lists them: Mon–Fri / Sat / Sun. */
function week(weekdays: Interval, saturday: Interval, sunday: Interval): Record<Weekday, DayHours | null> {
  return {
    mon: day(weekdays),
    tue: day(weekdays),
    wed: day(weekdays),
    thu: day(weekdays),
    fri: day(weekdays),
    sat: day(saturday),
    sun: day(sunday),
  };
}

function store(
  name: string,
  hours: Record<Weekday, DayHours | null>,
  prepMinutes: number,
  sameDayCutoff: string,
  deliveryRadiusKm: number,
  closures: string[] = [],
): TimingStore {
  return deepFreeze({
    name,
    status: 'live',
    acceptingOrders: true,
    fulfilment: { delivery: true, pickup: true, deliveryRadiusKm },
    hours,
    closures,
    prepMinutes,
    sameDayCutoff,
  });
}

/** A copy of a fixture with some fields changed. */
const withChanges = (base: TimingStore, changes: Partial<TimingStore>): TimingStore =>
  deepFreeze({ ...base, ...changes });

// The seed stores (§11.3): hours, prep minutes, same-day cut-off, delivery radius.
const kestrel = store('Kestrel Lumber Yard', week('06:30-18:00', '07:00-16:00', null), 25, '15:00', 45);
const grainline = store(
  'Grainline Building Centre',
  week('07:00-19:00', '08:00-17:00', '10:00-16:00'),
  20,
  '15:00',
  40,
);
const bluestone = store(
  'Bluestone Drywall & Paint',
  week('06:30-17:00', '07:00-13:00', null),
  20,
  '15:00',
  40,
);
const voltway = store('Voltway Electrical Supply', week('07:00-17:30', '08:00-13:00', null), 15, '15:30', 40);
const copperline = store(
  'Copperline Plumbing Depot',
  week('07:00-17:00', '08:00-14:00', null),
  15,
  '15:00',
  40,
);
const aircrest = store('Aircrest HVAC & Refrigeration', week('07:30-16:30', null, null), 20, '14:00', 35);
const boltbin = store(
  'Boltbin Fasteners & Hardware',
  week('07:00-18:00', '08:00-15:00', null),
  10,
  '16:00',
  45,
);
const glassmoor = store(
  'Glassmoor Glass & Mirror',
  week('08:00-17:00', '09:00-13:00', null),
  30,
  '14:00',
  30,
  ['2026-11-27'],
);

function trip(
  storeId: string,
  source: TimingStore,
  vehicleClass: VehicleClass,
  roadTenths: number,
): WindowStoreInput {
  return deepFreeze({ storeId, store: source, vehicleClass, roadTenths });
}

// Road km from the store pins to the Leslieville jobsite (§11.3); V1 loads need a pickup truck.
// §11.3 gives no distance for Aircrest: 18.0 km by SUV is made up for the multi-store cases.
const kestrelTrip = trip('kestrel-lumber', kestrel, 'pickup', 260);
const bluestoneTrip = trip('bluestone-drywall', bluestone, 'pickup', 229);
const boltbinTrip = trip('boltbin-hardware', boltbin, 'pickup', 389);
const voltwayTrip = trip('voltway-electrical', voltway, 'pickup', 304);
const grainlineTrip = trip('grainline-building', grainline, 'cargo_van', 164);
const glassmoorTrip = trip('glassmoor-glass', glassmoor, 'pickup', 72);
const aircrestTrip = trip('aircrest-hvac', aircrest, 'suv', 180);

const WED = '2026-11-18';
const THU = '2026-11-19';
const FRI = '2026-11-20';
const SAT = '2026-11-21';
const SUN = '2026-11-22';
const MON = '2026-11-23';
const TUE = '2026-11-24';

function option(options: readonly WindowOption[], id: string): WindowOption {
  const found = options.find((candidate) => candidate.id === id);
  assert.ok(found, `no window ${id}`);
  return found;
}

function available(options: readonly WindowOption[], id: string): AvailableWindow {
  const found = option(options, id);
  assert.ok(found.available, `${id} is unavailable: ${found.reason}`);
  return found;
}

function reasonOf(options: readonly WindowOption[], id: string): string {
  const found = option(options, id);
  assert.ok(!found.available, `${id} is available`);
  return found.reason;
}

/** `[readyBy, targetPickupAt, deliverBy]` of one store as Toronto clock times, for whole-minute cases. */
function clocks(timing: StoreTiming | undefined): [string, string, string] {
  assert.ok(timing, 'missing store timing');
  for (const instant of [timing.readyBy, timing.targetPickupAt, timing.deliverBy]) {
    assert.equal(instant % MINUTE, 0, 'expected a whole minute');
  }
  return [
    toClock(toLocal(timing.readyBy).minutes),
    toClock(toLocal(timing.targetPickupAt).minutes),
    toClock(toLocal(timing.deliverBy).minutes),
  ];
}

// ---------- constants ----------

describe('constants (§4.2, §4.4, §4.6)', () => {
  it('has the SLA table of §4.6', () => {
    assert.equal(STORE_ACCEPT_SLA_MIN, 10);
    assert.equal(STORE_REMINDER_BEFORE_MIN, 5);
    assert.equal(STORE_AUTO_REJECT_AFTER_MIN, 20);
    assert.equal(DISPATCH_BUFFER_MIN, 15);
    assert.equal(MIN_SCHEDULE_LEAD_MIN, 90);
    assert.equal(SCHEDULE_DAYS, 7);
    assert.equal(OFFER_LEAD_MIN, 720);
    assert.equal(JOB_UNCLAIMED_ALERT_MIN, 15);
    assert.equal(QUOTE_SLA_MIN, 30);
    assert.deepEqual([...QUOTE_VALID_HOURS], [24, 48, 72]);
    assert.equal(DEFAULT_QUOTE_VALID_HOURS, 48);
    assert.equal(ISSUE_SLA_HOURS, 4);
    assert.equal(CAPTURE_DEADLINE_DAYS, 6);
  });

  it('has the slots of §4.4 and the 7 pm limit of §4.2', () => {
    const weekdaySlots = ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00'];
    for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
      assert.deepEqual([...DELIVERY_SLOTS[weekday]], weekdaySlots);
    }
    assert.deepEqual([...DELIVERY_SLOTS.sat], ['08:00', '10:00', '12:00', '14:00']);
    assert.deepEqual([...DELIVERY_SLOTS.sun], ['10:00', '12:00', '14:00']);
    assert.equal(DELIVERY_SLOT_MINUTES, 120);
    assert.equal(LATEST_DROPOFF, '19:00');
    // No slot ends after the last drop-off.
    for (const slots of Object.values(DELIVERY_SLOTS)) {
      for (const slot of slots) assert.ok((parseClock(slot) ?? 9999) + DELIVERY_SLOT_MINUTES <= 19 * 60);
    }
  });
});

// ---------- store hours ----------

describe('roundUp5', () => {
  it('rounds an instant up to the next 5 minutes and leaves a round one alone', () => {
    sameInstant(roundUp5(at(THU, '13:37')), at(THU, '13:40'));
    sameInstant(roundUp5(at(THU, '13:47')), at(THU, '13:50'));
    sameInstant(roundUp5(at(THU, '13:40')), at(THU, '13:40'));
    sameInstant(roundUp5(at(THU, '13:40') + 1), at(THU, '13:45'));
    sameInstant(roundUp5(at(THU, '13:44') + 59_999), at(THU, '13:45'));
    sameInstant(roundUp5(at(THU, '23:58')), at(FRI, '00:00'));
  });
});

describe('store hours (§4.2)', () => {
  it('gives the interval of a weekday, as clock times and as instants', () => {
    assert.deepEqual(storeHoursOn(kestrel, THU), {
      open: '06:30',
      close: '18:00',
      date: THU,
      openAt: at(THU, '06:30'),
      closeAt: at(THU, '18:00'),
    });
    assert.deepEqual(storeHoursOn(kestrel, SAT), {
      open: '07:00',
      close: '16:00',
      date: SAT,
      openAt: at(SAT, '07:00'),
      closeAt: at(SAT, '16:00'),
    });
    assert.equal(storeHoursOn(kestrel, SUN), null);
    assert.equal(storeHoursOn(aircrest, SAT), null);
    assert.equal(storeHoursOn(grainline, SUN)?.open, '10:00');
  });

  it('closes every store on the Ontario holidays', () => {
    assert.equal(ONTARIO_HOLIDAYS.length, 23);
    for (const holiday of ONTARIO_HOLIDAYS) {
      for (const shop of [kestrel, grainline, bluestone, copperline]) {
        assert.equal(storeHoursOn(shop, holiday), null, holiday);
        assert.equal(isStoreOpenAt(shop, fromLocal(holiday, 12 * 60)), false, holiday);
      }
    }
    // Christmas 2026 is a Friday; the Thursday before is a normal day.
    assert.equal(weekdayOf('2026-12-25'), 'fri');
    assert.ok(storeHoursOn(kestrel, '2026-12-24'));
  });

  it('closes a store on its own closure dates and only on those', () => {
    assert.equal(storeHoursOn(glassmoor, '2026-11-27'), null);
    assert.equal(storeHoursOn(glassmoor, '2026-11-26')?.close, '17:00');
    assert.equal(storeHoursOn(glassmoor, '2026-11-28')?.open, '09:00');
    // The stock-take is Glassmoor's alone.
    assert.ok(storeHoursOn(kestrel, '2026-11-27'));
  });

  it('counts hours it cannot read as closed', () => {
    const broken = (hours: DayHours) => withChanges(kestrel, { hours: { ...kestrel.hours, thu: hours } });
    assert.equal(storeHoursOn(broken({ open: '18:00', close: '06:30' }), THU), null);
    assert.equal(storeHoursOn(broken({ open: '09:00', close: '09:00' }), THU), null);
    assert.equal(storeHoursOn(broken({ open: '9:00', close: '17:00' }), THU), null);
    assert.equal(storeHoursOn(broken({ open: '09:00', close: '24:00' }), THU), null);
    assert.equal(storeHoursOn(kestrel, '2026-02-30'), null);
    assert.equal(storeHoursOn(kestrel, 'thursday'), null);
  });

  it('is open from the opening time up to, but not including, the closing time', () => {
    assert.equal(isStoreOpenAt(kestrel, at(THU, '06:30') - 1), false);
    assert.equal(isStoreOpenAt(kestrel, at(THU, '06:30')), true);
    assert.equal(isStoreOpenAt(kestrel, at(THU, '12:25')), true);
    assert.equal(isStoreOpenAt(kestrel, at(THU, '18:00') - 1), true);
    assert.equal(isStoreOpenAt(kestrel, at(THU, '18:00')), false);
    assert.equal(isStoreOpenAt(kestrel, at(SAT, '16:00') - 1), true);
    assert.equal(isStoreOpenAt(kestrel, at(SAT, '17:00')), false);
    assert.equal(isStoreOpenAt(kestrel, at(SUN, '12:00')), false);
    assert.equal(isStoreOpenAt(grainline, at(SUN, '12:00')), true);
    assert.equal(isStoreOpenAt(glassmoor, at('2026-11-27', '12:00')), false);
  });

  it('finds the next opening: later today, tomorrow, after the weekend', () => {
    sameInstant(nextOpeningAt(kestrel, at(THU, '05:00')), at(THU, '06:30'));
    sameInstant(nextOpeningAt(kestrel, at(THU, '06:30') - 1), at(THU, '06:30'));
    // Once it is open, the next opening is the next day's.
    sameInstant(nextOpeningAt(kestrel, at(THU, '06:30')), at(FRI, '06:30'));
    sameInstant(nextOpeningAt(kestrel, at(THU, '12:25')), at(FRI, '06:30'));
    sameInstant(nextOpeningAt(kestrel, at(THU, '19:00')), at(FRI, '06:30'));
    sameInstant(nextOpeningAt(kestrel, at(FRI, '19:00')), at(SAT, '07:00'));
    sameInstant(nextOpeningAt(kestrel, at(SAT, '16:30')), at(MON, '06:30'));
    sameInstant(nextOpeningAt(kestrel, at(SUN, '12:00')), at(MON, '06:30'));
    sameInstant(nextOpeningAt(grainline, at(SAT, '18:00')), at(SUN, '10:00'));
    sameInstant(nextOpeningAt(aircrest, at(FRI, '16:30')), at(MON, '07:30'));
  });

  it('skips holidays and closures when looking for the next opening', () => {
    // Christmas Day (Fri), Boxing Day (Sat), Sunday, and Monday in lieu: Kestrel reopens on Tuesday.
    sameInstant(nextOpeningAt(kestrel, at('2026-12-24', '18:30')), at('2026-12-29', '06:30'));
    sameInstant(nextOpeningAt(glassmoor, at('2026-11-26', '17:00')), at('2026-11-28', '09:00'));
  });

  it('looks 14 days ahead and no further', () => {
    const closedFrom = (first: string, days: number) =>
      withChanges(kestrel, {
        hours: week('06:30-18:00', '06:30-18:00', '06:30-18:00'),
        closures: Array.from({ length: days }, (_, index) => addLocalDays(first, index)),
      });
    const now = at(THU, '19:00');
    // Closed for the next 13 days: it reopens on the 14th day after today.
    sameInstant(nextOpeningAt(closedFrom(FRI, 13), now), at('2026-12-03', '06:30'));
    assert.equal(nextOpeningAt(closedFrom(FRI, 14), now), null);
    assert.equal(nextOpeningAt(withChanges(kestrel, { hours: week(null, null, null) }), now), null);
  });
});

// ---------- ASAP ----------

describe('ASAP (§4.3)', () => {
  const now = at(THU, '12:25');

  it('reproduces the §4.8 example: Bluestone by 1:40 pm, Kestrel by 1:50 pm', () => {
    const fromBluestone = asapPromise(bluestoneTrip, now);
    // Prep 20, 22.9 km at 38 km/h = 37 min: pickup 12:45, 13:37 rounds up to 13:40.
    assert.deepEqual(fromBluestone, {
      ok: true,
      timing: {
        storeId: 'bluestone-drywall',
        readyBy: at(THU, '12:45'),
        targetPickupAt: at(THU, '12:45'),
        deliverBy: at(THU, '13:40'),
      },
    });
    // Prep 25, 26.0 km = 42 min: pickup 12:50, 13:47 rounds up to 13:50.
    assert.deepEqual(asapPromise(kestrelTrip, now), {
      ok: true,
      timing: {
        storeId: 'kestrel-lumber',
        readyBy: at(THU, '12:50'),
        targetPickupAt: at(THU, '12:50'),
        deliverBy: at(THU, '13:50'),
      },
    });
    assert.ok(fromBluestone.ok);
    assert.equal(formatClockET(fromBluestone.timing.deliverBy), '1:40 pm');
  });

  it('promises the order "Today by 1:50 pm", the latest of its stores', () => {
    const window = asapWindow([bluestoneTrip, kestrelTrip], now);
    assert.deepEqual(window, {
      id: 'asap',
      kind: 'asap',
      date: THU,
      startAt: null,
      label: 'Today by 1:50 pm',
      available: true,
      endAt: at(THU, '13:50'),
      reason: null,
      stores: [
        {
          storeId: 'bluestone-drywall',
          readyBy: at(THU, '12:45'),
          targetPickupAt: at(THU, '12:45'),
          deliverBy: at(THU, '13:40'),
        },
        {
          storeId: 'kestrel-lumber',
          readyBy: at(THU, '12:50'),
          targetPickupAt: at(THU, '12:50'),
          deliverBy: at(THU, '13:50'),
        },
      ],
    });
    // The stores keep the order they were passed in.
    const reversed = asapWindow([kestrelTrip, bluestoneTrip], now);
    assert.deepEqual(
      reversed.stores.map((timing) => timing.storeId),
      ['kestrel-lumber', 'bluestone-drywall'],
    );
    assert.equal(reversed.endAt, at(THU, '13:50'));
    assert.equal(asapWindow([bluestoneTrip], now).label, 'Today by 1:40 pm');
  });

  it('plans the pickup after max(prep, 15) minutes but the goods after prep', () => {
    // Boltbin needs 10 minutes; a driver still needs 15 to be matched and get there. 38.9 km = 62 min.
    assert.deepEqual(clocks(asapWindow([boltbinTrip], now).stores[0]), ['12:35', '12:40', '14:00']);
    assert.equal(asapWindow([boltbinTrip], now).label, 'Today by 2:00 pm');
  });

  it('takes loading minutes and speed from the vehicle class', () => {
    // 26.0 km by flatbed: 20 min loading, 30 km/h = 52 min; by car: 5 min, 40 km/h = 39 min.
    const flatbed = trip('kestrel-lumber', kestrel, 'flatbed', 260);
    const car = trip('kestrel-lumber', kestrel, 'car', 260);
    assert.deepEqual(clocks(asapWindow([flatbed], now).stores[0]), ['12:50', '12:50', '14:05']);
    assert.deepEqual(clocks(asapWindow([car], now).stores[0]), ['12:50', '12:50', '13:35']);
    // No distance at all still takes the loading time.
    const nextDoor = trip('kestrel-lumber', kestrel, 'pickup', 0);
    assert.deepEqual(clocks(asapWindow([nextDoor], now).stores[0]), ['12:50', '12:50', '13:05']);
  });

  it('keeps the seconds of now in the plan and rounds only the promise', () => {
    const promise = asapPromise(kestrelTrip, now + 30 * SECOND);
    assert.ok(promise.ok);
    assert.equal(promise.timing.readyBy, at(THU, '12:50') + 30 * SECOND);
    assert.equal(promise.timing.targetPickupAt, at(THU, '12:50') + 30 * SECOND);
    sameInstant(promise.timing.deliverBy, at(THU, '13:50'));
  });

  it('stops at the same-day cut-off, to the millisecond', () => {
    const justBefore = asapPromise(kestrelTrip, at(THU, '15:00') - 1);
    assert.ok(justBefore.ok);
    // Pickup 15:24:59.999 + 57 min = 16:21:59.999, promised by 16:25.
    sameInstant(justBefore.timing.deliverBy, at(THU, '16:25'));
    assert.deepEqual(asapPromise(kestrelTrip, at(THU, '15:00')), {
      ok: false,
      storeId: 'kestrel-lumber',
      reason: 'Same-day cut-off was 3:00 pm',
    });
    // §4.8: at 15:10 both 15:00 cut-offs have passed.
    assert.deepEqual(asapWindow([bluestoneTrip, kestrelTrip], at(THU, '15:10')), {
      id: 'asap',
      kind: 'asap',
      date: THU,
      startAt: null,
      label: 'ASAP',
      available: false,
      endAt: null,
      reason: 'Same-day cut-off was 3:00 pm',
      stores: [],
    });
    // Voltway's cut-off is 15:30: 30.4 km = 48 min, pickup 15:25, 16:28 → 16:30.
    assert.deepEqual(clocks(asapWindow([voltwayTrip], at(THU, '15:10')).stores[0]), [
      '15:25',
      '15:25',
      '16:30',
    ]);
    assert.equal(asapWindow([aircrestTrip], at(THU, '14:30')).reason, 'Same-day cut-off was 2:00 pm');
  });

  it('needs the store to be open now', () => {
    for (const closedAt of [
      at(THU, '06:30') - 1,
      at(THU, '18:00'),
      at(THU, '23:00'),
      at(SUN, '12:00'),
      at('2026-12-25', '12:00'),
    ]) {
      assert.equal(
        asapWindow([kestrelTrip], closedAt).reason,
        'Kestrel is closed right now',
        stamp(closedAt),
      );
    }
    assert.equal(
      asapWindow([glassmoorTrip], at('2026-11-27', '10:00')).reason,
      'Glassmoor is closed right now',
    );
    assert.ok(asapWindow([kestrelTrip], at(THU, '06:30')).available);
  });

  it('needs loading to end before the store closes', () => {
    // Bluestone closes at 13:00 on Saturday: pickup 12:45 + 15 min loading is the last one.
    const lastOne = asapWindow([bluestoneTrip], at(SAT, '12:25'));
    assert.deepEqual(clocks(lastOne.stores[0]), ['12:45', '12:45', '13:40']);
    assert.equal(asapWindow([bluestoneTrip], at(SAT, '12:25') + 1).reason, 'Bluestone closes at 1:00 pm');
    assert.equal(asapWindow([bluestoneTrip], at(SAT, '12:50')).reason, 'Bluestone closes at 1:00 pm');
  });

  it('promises nothing after 7 pm', () => {
    const nightOwl = store(
      'Nightowl Supply',
      week('07:00-21:00', '07:00-21:00', '07:00-21:00'),
      20,
      '20:00',
      40,
    );
    const late = trip('nightowl', nightOwl, 'pickup', 229);
    // Pickup 18:08 + 15 + 37 = 19:00 exactly: still allowed.
    assert.deepEqual(clocks(asapWindow([late], at(THU, '17:48')).stores[0]), ['18:08', '18:08', '19:00']);
    assert.deepEqual(clocks(asapWindow([late], at(THU, '17:45')).stores[0]), ['18:05', '18:05', '19:00']);
    const tooLate = 'Too late to deliver today — deliveries end at 7:00 pm';
    assert.equal(asapWindow([late], at(THU, '17:48') + 1).reason, tooLate);
    assert.equal(asapWindow([late], at(THU, '19:30')).reason, tooLate);
  });

  it('needs a live store that accepts orders and delivers', () => {
    const cases: [Partial<TimingStore>, string][] = [
      [{ status: 'coming_soon' }, "Kestrel isn't taking orders"],
      [{ status: 'onboarding' }, "Kestrel isn't taking orders"],
      [{ status: 'closed' }, "Kestrel isn't taking orders"],
      [{ acceptingOrders: false }, 'Kestrel has paused new orders'],
      [{ fulfilment: { delivery: false, pickup: true, deliveryRadiusKm: 45 } }, "Kestrel doesn't deliver"],
      [{ sameDayCutoff: 'noon' }, 'Kestrel has no same-day delivery'],
      // A store document without a usable prep time gets no promise: never a time of NaN.
      [{ prepMinutes: Number.NaN }, "Kestrel isn't taking orders"],
      [{ prepMinutes: -5 }, "Kestrel isn't taking orders"],
      [{ prepMinutes: undefined as unknown as number }, "Kestrel isn't taking orders"],
    ];
    for (const [changes, reason] of cases) {
      const input = trip('kestrel-lumber', withChanges(kestrel, changes), 'pickup', 260);
      assert.deepEqual(asapPromise(input, now), { ok: false, storeId: 'kestrel-lumber', reason });
    }
    // The rules are checked in the order of §4.3: a paused store that is also closed is "paused".
    const pausedAtNight = trip(
      'kestrel-lumber',
      withChanges(kestrel, { acceptingOrders: false }),
      'pickup',
      260,
    );
    assert.equal(asapWindow([pausedAtNight], at(THU, '23:00')).reason, 'Kestrel has paused new orders');
  });

  it('calls a store by the first word of its name, as the spec does', () => {
    const night = at(THU, '23:00');
    const named = (name: string) => trip('some-store', withChanges(kestrel, { name }), 'pickup', 260);
    assert.equal(asapWindow([named('Kestrel Lumber Yard')], night).reason, 'Kestrel is closed right now');
    assert.equal(asapWindow([named('  Boltbin   Fasteners ')], night).reason, 'Boltbin is closed right now');
    assert.equal(asapWindow([named('Voltway')], night).reason, 'Voltway is closed right now');
    // "The is closed" would be nonsense: a name that starts with an article is kept whole.
    assert.equal(asapWindow([named('The Brick Yard')], night).reason, 'The Brick Yard is closed right now');
    assert.equal(asapWindow([named('A Plus Plumbing')], night).reason, 'A Plus Plumbing is closed right now');
    assert.equal(asapWindow([named('')], night).reason, 'The store is closed right now');
  });

  it('is off for the whole order with the first failing reason', () => {
    const paused = trip('kestrel-lumber', withChanges(kestrel, { acceptingOrders: false }), 'pickup', 260);
    const afterTwo = at(THU, '14:30');
    assert.equal(asapWindow([bluestoneTrip, paused], afterTwo).reason, 'Kestrel has paused new orders');
    assert.equal(asapWindow([paused, aircrestTrip], afterTwo).reason, 'Kestrel has paused new orders');
    assert.equal(asapWindow([aircrestTrip, paused], afterTwo).reason, 'Same-day cut-off was 2:00 pm');
    assert.equal(asapWindow([bluestoneTrip, kestrelTrip], afterTwo).available, true);
  });

  it('is never offered for an order with no stores', () => {
    assert.deepEqual(asapWindow([], now), {
      id: 'asap',
      kind: 'asap',
      date: THU,
      startAt: null,
      label: 'ASAP',
      available: false,
      endAt: null,
      reason: 'ASAP is not available for this order',
      stores: [],
    });
  });
});

// ---------- scheduled windows ----------

describe('scheduled windows (§4.4)', () => {
  const stores = [kestrelTrip, bluestoneTrip];
  const afterCutoff = at(THU, '15:10');
  const options = scheduledWindows(stores, afterCutoff);

  it('lists every slot of today and the next 6 days, in time order', () => {
    const weekdaySlots = ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00'];
    const expected = [
      ...weekdaySlots.map((slot) => `${THU}T${slot}`),
      ...weekdaySlots.map((slot) => `${FRI}T${slot}`),
      ...['08:00', '10:00', '12:00', '14:00'].map((slot) => `${SAT}T${slot}`),
      ...['10:00', '12:00', '14:00'].map((slot) => `${SUN}T${slot}`),
      ...weekdaySlots.map((slot) => `${MON}T${slot}`),
      ...weekdaySlots.map((slot) => `${TUE}T${slot}`),
      ...weekdaySlots.map((slot) => `2026-11-25T${slot}`),
    ];
    assert.equal(expected.length, 37);
    assert.deepEqual(
      options.map((window) => window.id),
      expected,
    );
    for (const window of options) {
      assert.equal(window.kind, 'scheduled');
      assert.equal(window.id, `${window.date}T${window.id.slice(11)}`);
      sameInstant(window.startAt, at(window.date, window.id.slice(11)), window.id);
      assert.equal(window.endAt, (window.startAt ?? 0) + 2 * HOUR, window.id);
    }
  });

  it('turns today off after the cut-off (§4.8, 15:10)', () => {
    for (const slot of ['07:00', '09:00', '11:00', '13:00', '15:00']) {
      assert.equal(reasonOf(options, `${THU}T${slot}`), 'No longer available');
    }
    // 17:00 is more than 90 minutes away, but both stores stopped same-day orders at 15:00.
    assert.deepEqual(option(options, `${THU}T17:00`), {
      id: `${THU}T17:00`,
      kind: 'scheduled',
      date: THU,
      startAt: at(THU, '17:00'),
      label: 'Today, 5–7 pm',
      available: false,
      endAt: at(THU, '19:00'),
      reason: 'Same-day cut-off was 3:00 pm',
      stores: [],
    });
  });

  it('makes all six Friday slots valid, with the pickups of §4.8', () => {
    // [readyBy, targetPickupAt, deliverBy] for Kestrel (57 min of loading and driving) and Bluestone (52).
    const friday: Record<string, [[string, string, string], [string, string, string]]> = {
      '07:00': [
        ['06:30', '06:30', '09:00'],
        ['06:30', '06:30', '09:00'],
      ],
      '09:00': [
        ['07:48', '08:03', '11:00'],
        ['07:53', '08:08', '11:00'],
      ],
      '11:00': [
        ['09:48', '10:03', '13:00'],
        ['09:53', '10:08', '13:00'],
      ],
      '13:00': [
        ['11:48', '12:03', '15:00'],
        ['11:53', '12:08', '15:00'],
      ],
      '15:00': [
        ['13:48', '14:03', '17:00'],
        ['13:53', '14:08', '17:00'],
      ],
      '17:00': [
        ['15:48', '16:03', '19:00'],
        ['15:53', '16:08', '19:00'],
      ],
    };
    for (const [slot, [forKestrel, forBluestone]] of Object.entries(friday)) {
      const window = available(options, `${FRI}T${slot}`);
      assert.equal(window.date, FRI);
      assert.equal(window.reason, null);
      assert.deepEqual(
        window.stores.map((timing) => timing.storeId),
        ['kestrel-lumber', 'bluestone-drywall'],
      );
      assert.deepEqual(clocks(window.stores[0]), forKestrel, `Kestrel ${slot}`);
      assert.deepEqual(clocks(window.stores[1]), forBluestone, `Bluestone ${slot}`);
      for (const timing of window.stores) assert.equal(localDateOf(timing.targetPickupAt), FRI);
    }
    assert.deepEqual(available(options, `${FRI}T07:00`), {
      id: `${FRI}T07:00`,
      kind: 'scheduled',
      date: FRI,
      startAt: at(FRI, '07:00'),
      label: 'Tomorrow, 7–9 am',
      available: true,
      endAt: at(FRI, '09:00'),
      reason: null,
      stores: [
        {
          storeId: 'kestrel-lumber',
          readyBy: at(FRI, '06:30'),
          targetPickupAt: at(FRI, '06:30'),
          deliverBy: at(FRI, '09:00'),
        },
        {
          storeId: 'bluestone-drywall',
          readyBy: at(FRI, '06:30'),
          targetPickupAt: at(FRI, '06:30'),
          deliverBy: at(FRI, '09:00'),
        },
      ],
    });
  });

  it('plans Saturday around the shorter hours (§4.8)', () => {
    const saturday: Record<string, [[string, string, string], [string, string, string]]> = {
      '08:00': [
        ['07:00', '07:03', '10:00'],
        ['07:00', '07:08', '10:00'],
      ],
      '10:00': [
        ['08:48', '09:03', '12:00'],
        ['08:53', '09:08', '12:00'],
      ],
      '12:00': [
        ['10:48', '11:03', '14:00'],
        ['10:53', '11:08', '14:00'],
      ],
      // Bluestone closes at 13:00, so its loading must end by then: pickup 12:45, not 13:08.
      '14:00': [
        ['12:48', '13:03', '16:00'],
        ['12:30', '12:45', '16:00'],
      ],
    };
    for (const [slot, [forKestrel, forBluestone]] of Object.entries(saturday)) {
      const window = available(options, `${SAT}T${slot}`);
      assert.deepEqual(clocks(window.stores[0]), forKestrel, `Kestrel ${slot}`);
      assert.deepEqual(clocks(window.stores[1]), forBluestone, `Bluestone ${slot}`);
    }
    assert.equal(available(options, `${SAT}T08:00`).label, 'Sat, Nov 21, 8–10 am');
    assert.equal(available(options, `${SAT}T10:00`).label, 'Sat, Nov 21, 10 am–12 pm');
  });

  it('has no Sunday slot: "Kestrel and Bluestone are closed Sunday" (§4.8)', () => {
    for (const slot of ['10:00', '12:00', '14:00']) {
      assert.equal(reasonOf(options, `${SUN}T${slot}`), 'Kestrel and Bluestone are closed Sunday');
    }
    assert.equal(option(options, `${SUN}T10:00`).label, 'Sun, Nov 22, 10 am–12 pm');
    // The names follow the order of the stores in the order.
    const lettered = scheduledWindows([bluestoneTrip, kestrelTrip], afterCutoff);
    assert.equal(reasonOf(lettered, `${SUN}T12:00`), 'Bluestone and Kestrel are closed Sunday');
  });

  it('makes the weekdays after the weekend valid like Friday', () => {
    for (const date of [MON, TUE, '2026-11-25']) {
      for (const slot of DELIVERY_SLOTS.mon) assert.ok(available(options, `${date}T${slot}`));
      assert.deepEqual(clocks(available(options, `${date}T09:00`).stores[0]), ['07:48', '08:03', '11:00']);
    }
    assert.equal(options.filter((window) => window.available).length, 6 + 4 + 18);
  });

  it('opens the job offer 12 hours before the pickup: Thu 6:30 pm for Fri 07–09 (§4.8)', () => {
    const [forKestrel] = available(options, `${FRI}T07:00`).stores;
    assert.ok(forKestrel);
    const acceptedAt = at(THU, '15:12');
    sameInstant(offerOpensAt(forKestrel.targetPickupAt, acceptedAt), at(THU, '18:30'));
    assert.equal(formatClockET(offerOpensAt(forKestrel.targetPickupAt, acceptedAt)), '6:30 pm');
  });

  it('needs 90 minutes of lead time: "Too soon — earliest 2:00 pm"', () => {
    const atHalfPast = scheduledWindows([kestrelTrip], at(THU, '12:30'));
    assert.equal(reasonOf(atHalfPast, `${THU}T13:00`), 'Too soon — earliest 2:00 pm');
    assert.equal(reasonOf(atHalfPast, `${THU}T11:00`), 'No longer available');

    const lunch = scheduledWindows([kestrelTrip], at(THU, '12:25'));
    assert.equal(reasonOf(lunch, `${THU}T13:00`), 'Too soon — earliest 1:55 pm');
    for (const slot of ['07:00', '09:00', '11:00']) {
      assert.equal(reasonOf(lunch, `${THU}T${slot}`), 'No longer available');
    }
    // 15:00 is far enough. Today the store needs its prep time first (12:50); the driver aims to
    // arrive as the window opens: 15:00 − 57 min = 14:03.
    assert.deepEqual(clocks(available(lunch, `${THU}T15:00`).stores[0]), ['13:48', '14:03', '17:00']);
    assert.equal(available(lunch, `${THU}T15:00`).label, 'Today, 3–5 pm');
    assert.deepEqual(clocks(available(lunch, `${THU}T17:00`).stores[0]), ['15:48', '16:03', '19:00']);

    // Exactly 90 minutes is enough; one millisecond less is not.
    const onTheDot = scheduledWindows([kestrelTrip], at(THU, '11:30'));
    assert.deepEqual(clocks(available(onTheDot, `${THU}T13:00`).stores[0]), ['11:55', '12:03', '15:00']);
    const justLate = scheduledWindows([kestrelTrip], at(THU, '11:30') + 1);
    assert.equal(reasonOf(justLate, `${THU}T13:00`), 'Too soon — earliest 1:05 pm');

    // A window that starts this very moment has begun; a millisecond earlier it is merely too soon.
    assert.equal(
      reasonOf(scheduledWindows([kestrelTrip], at(THU, '13:00')), `${THU}T13:00`),
      'No longer available',
    );
    assert.equal(
      reasonOf(scheduledWindows([kestrelTrip], at(THU, '13:00') - 1), `${THU}T13:00`),
      'Too soon — earliest 2:30 pm',
    );
  });

  it('applies the same-day cut-off to today only, to the millisecond', () => {
    const before = scheduledWindows([kestrelTrip], at(THU, '15:00') - 1);
    assert.ok(available(before, `${THU}T17:00`));
    const onTheDot = scheduledWindows([kestrelTrip], at(THU, '15:00'));
    assert.equal(reasonOf(onTheDot, `${THU}T17:00`), 'Same-day cut-off was 3:00 pm');
    assert.ok(available(onTheDot, `${FRI}T07:00`));

    // A cut-off that cannot be read stops today's deliveries, and only today's.
    const unreadable = trip('kestrel-lumber', withChanges(kestrel, { sameDayCutoff: '3 pm' }), 'pickup', 260);
    const windows = scheduledWindows([unreadable, bluestoneTrip], at(THU, '12:25'));
    assert.equal(reasonOf(windows, `${THU}T15:00`), 'Kestrel has no same-day delivery');
    assert.equal(reasonOf(windows, `${THU}T17:00`), 'Kestrel has no same-day delivery');
    assert.deepEqual(clocks(available(windows, `${FRI}T09:00`).stores[0]), ['07:48', '08:03', '11:00']);
  });

  it('waits for the prep time on a same-day slot', () => {
    // Two hours of prep from 13:00: the goods are ready at 15:00, so that is the pickup.
    const slow = trip('kestrel-lumber', withChanges(kestrel, { prepMinutes: 120 }), 'pickup', 260);
    const today = scheduledWindows([slow], at(THU, '13:00'));
    assert.deepEqual(clocks(available(today, `${THU}T15:00`).stores[0]), ['15:00', '15:00', '17:00']);
    // On a later day the order is staged before opening, whatever the prep time.
    assert.deepEqual(clocks(available(today, `${FRI}T07:00`).stores[0]), ['06:30', '06:30', '09:00']);
    // Even a prep time that runs past the next opening does not move a later day's pickup. (Stores are
    // limited to 240 minutes; 8 hours here isolates the rule: Thursday 23:00 + 8 h is Friday 07:00.)
    const overnight = trip('kestrel-lumber', withChanges(kestrel, { prepMinutes: 480 }), 'pickup', 260);
    const lateEvening = scheduledWindows([overnight], at(THU, '23:00'));
    assert.deepEqual(clocks(available(lateEvening, `${FRI}T07:00`).stores[0]), ['06:30', '06:30', '09:00']);
    assert.deepEqual(clocks(available(lateEvening, `${FRI}T09:00`).stores[0]), ['07:48', '08:03', '11:00']);

    // Four hours of prep from 12:10 ends at 16:10; the 15–17 window needs a pickup by 16:03.
    const slower = trip('kestrel-lumber', withChanges(kestrel, { prepMinutes: 240 }), 'pickup', 260);
    const later = scheduledWindows([slower], at(THU, '12:10'));
    assert.equal(reasonOf(later, `${THU}T15:00`), "Kestrel can't have it ready in time");
    assert.deepEqual(clocks(available(later, `${THU}T17:00`).stores[0]), ['16:10', '16:10', '19:00']);
  });

  it('refuses a slot the store closes too early for: "Bluestone closes at 1:00 pm Saturday"', () => {
    // Saturday 12:25, prep 20: ready 12:45, loaded by the 13:00 close. One minute later it is not.
    const inTime = scheduledWindows([bluestoneTrip], at(SAT, '12:25'));
    assert.deepEqual(clocks(available(inTime, `${SAT}T14:00`).stores[0]), ['12:45', '12:45', '16:00']);
    const tooLate = scheduledWindows([bluestoneTrip], at(SAT, '12:26'));
    assert.equal(reasonOf(tooLate, `${SAT}T14:00`), 'Bluestone closes at 1:00 pm Saturday');
    assert.ok(available(tooLate, `${MON}T07:00`));
    // The limit is exact: ordered at 12:25 the load is on the truck at 13:00 sharp, so the closing
    // time is not what stands in the way. (120 km is beyond every delivery radius; the 190-minute
    // drive only serves to make the window fail for another reason.)
    const farAway = trip('bluestone-drywall', bluestone, 'pickup', 1200);
    assert.equal(
      reasonOf(scheduledWindows([farAway], at(SAT, '12:25')), `${SAT}T14:00`),
      "Bluestone can't have it ready in time",
    );
  });

  it('refuses a slot the store opens too late for', () => {
    // 30.0 km by pickup truck: 48 min driving + 15 min loading = 63 min.
    const far = trip('glassmoor-glass', glassmoor, 'pickup', 300);
    const fromGlassmoor = scheduledWindows([far], afterCutoff);
    // Glassmoor opens at 08:00; a load picked up then reaches the site at 09:03, after the 07–09 window.
    assert.equal(reasonOf(fromGlassmoor, `${FRI}T07:00`), 'Glassmoor opens at 8:00 am Friday');
    assert.deepEqual(clocks(available(fromGlassmoor, `${FRI}T09:00`).stores[0]), ['08:00', '08:00', '11:00']);
    assert.equal(reasonOf(fromGlassmoor, `${SAT}T08:00`), 'Glassmoor opens at 9:00 am Saturday');
    assert.deepEqual(clocks(available(fromGlassmoor, `${SAT}T10:00`).stores[0]), ['09:00', '09:00', '12:00']);
    assert.deepEqual(clocks(available(fromGlassmoor, `${SAT}T14:00`).stores[0]), ['12:30', '12:45', '16:00']);
    // From 7.2 km (12 min) the first Saturday window works: pickup at the 09:00 opening.
    const near = scheduledWindows([glassmoorTrip], afterCutoff);
    assert.deepEqual(clocks(available(near, `${SAT}T08:00`).stores[0]), ['09:00', '09:00', '10:00']);
  });

  it('offers only the slots that work for every store', () => {
    const withAircrest = scheduledWindows([kestrelTrip, aircrestTrip], afterCutoff);
    for (const slot of DELIVERY_SLOTS.sat) {
      assert.equal(reasonOf(withAircrest, `${SAT}T${slot}`), 'Aircrest is closed Saturday');
    }
    assert.equal(reasonOf(withAircrest, `${SUN}T10:00`), 'Kestrel and Aircrest are closed Sunday');
    assert.ok(available(withAircrest, `${FRI}T09:00`));

    const three = scheduledWindows([kestrelTrip, bluestoneTrip, aircrestTrip], afterCutoff);
    assert.equal(reasonOf(three, `${SUN}T14:00`), 'Kestrel, Bluestone and Aircrest are closed Sunday');
    assert.equal(reasonOf(three, `${SAT}T08:00`), 'Aircrest is closed Saturday');
    // Aircrest opens at 07:30: 18.0 km by SUV = 27 min + 10 min loading.
    assert.deepEqual(clocks(available(three, `${FRI}T07:00`).stores[2]), ['07:30', '07:30', '09:00']);
    assert.deepEqual(clocks(available(three, `${FRI}T09:00`).stores[2]), ['08:08', '08:23', '11:00']);

    // Grainline is open on Sunday (10:00–16:00): 16.4 km by cargo van = 28 min + 15 min loading.
    const sunday = scheduledWindows([grainlineTrip], afterCutoff);
    assert.deepEqual(clocks(available(sunday, `${SUN}T10:00`).stores[0]), ['10:00', '10:00', '12:00']);
    assert.deepEqual(clocks(available(sunday, `${SUN}T14:00`).stores[0]), ['13:02', '13:17', '16:00']);
    const mixed = scheduledWindows([kestrelTrip, grainlineTrip], afterCutoff);
    assert.equal(reasonOf(mixed, `${SUN}T10:00`), 'Kestrel is closed Sunday');
  });

  it("uses each store's own cut-off and reports the first one that has passed", () => {
    // 15:29: Kestrel stopped at 15:00, Voltway (15:30) and Boltbin (16:00) have not.
    const almost = at(THU, '15:29');
    const withKestrel = scheduledWindows([voltwayTrip, kestrelTrip], almost);
    assert.equal(reasonOf(withKestrel, `${THU}T17:00`), 'Same-day cut-off was 3:00 pm');
    const window = available(scheduledWindows([voltwayTrip, boltbinTrip], almost), `${THU}T17:00`);
    // Voltway: prep 15 → 15:44; 63 min before 17:00 is 15:57. Boltbin: prep 10 → 15:39; 77 min → 15:43.
    assert.deepEqual(clocks(window.stores[0]), ['15:44', '15:57', '19:00']);
    assert.deepEqual(clocks(window.stores[1]), ['15:39', '15:43', '19:00']);
    // 15:30 is still 90 minutes before 17:00, but Voltway's cut-off has now passed.
    const halfPast = scheduledWindows([voltwayTrip, boltbinTrip], at(THU, '15:30'));
    assert.equal(reasonOf(halfPast, `${THU}T17:00`), 'Same-day cut-off was 3:30 pm');
  });

  it('delivers nothing on a holiday', () => {
    // Wed 2026-12-23, 10:00. Fri 25, Sat 26 and Mon 28 are holidays; Sun 27 Kestrel is closed anyway.
    const now = at('2026-12-23', '10:00');
    const christmas = scheduledWindows([kestrelTrip], now);
    assert.equal(christmas.length, 6 + 6 + 6 + 4 + 3 + 6 + 6);
    for (const window of christmas) {
      if (['2026-12-25', '2026-12-26', '2026-12-28'].includes(window.date)) {
        assert.equal(window.available ? null : window.reason, 'Holiday — no deliveries', window.id);
      }
    }
    assert.equal(reasonOf(christmas, '2026-12-27T10:00'), 'Kestrel is closed Sunday');
    assert.equal(reasonOf(christmas, '2026-12-23T09:00'), 'No longer available');
    assert.equal(reasonOf(christmas, '2026-12-23T11:00'), 'Too soon — earliest 11:30 am');
    assert.deepEqual(
      christmas.filter((window) => window.available).map((window) => window.id),
      [
        '2026-12-23T13:00',
        '2026-12-23T15:00',
        '2026-12-23T17:00',
        ...DELIVERY_SLOTS.thu.map((slot) => `2026-12-24T${slot}`),
        ...DELIVERY_SLOTS.tue.map((slot) => `2026-12-29T${slot}`),
      ],
    );
    // After Thursday's cut-off the earliest window is Tuesday morning.
    const next = earliestWindow([kestrelTrip], at('2026-12-24', '15:30'));
    assert.equal(next?.id, '2026-12-29T07:00');
    assert.equal(next?.label, 'Tue, Dec 29, 7–9 am');
    assert.deepEqual(clocks(next?.stores[0]), ['06:30', '06:30', '09:00']);
  });

  it("skips a store's own closure date", () => {
    // Glassmoor is closed for a stock-take on Fri 2026-11-27.
    const fromMonday = scheduledWindows([glassmoorTrip], at(MON, '09:00'));
    for (const slot of DELIVERY_SLOTS.fri) {
      assert.equal(reasonOf(fromMonday, `2026-11-27T${slot}`), 'Glassmoor is closed Friday');
    }
    assert.ok(available(fromMonday, '2026-11-26T17:00'));
    assert.deepEqual(clocks(available(fromMonday, '2026-11-28T08:00').stores[0]), [
      '09:00',
      '09:00',
      '10:00',
    ]);
    const both = scheduledWindows([kestrelTrip, glassmoorTrip], at(MON, '09:00'));
    assert.equal(reasonOf(both, '2026-11-27T09:00'), 'Glassmoor is closed Friday');
  });

  it('offers no window for a store that cannot take the order', () => {
    const cases: [Partial<TimingStore>, string][] = [
      [{ status: 'coming_soon' }, "Kestrel isn't taking orders"],
      [{ acceptingOrders: false }, 'Kestrel has paused new orders'],
      [{ fulfilment: { delivery: false, pickup: true, deliveryRadiusKm: 45 } }, "Kestrel doesn't deliver"],
    ];
    for (const [changes, reason] of cases) {
      const blocked = trip('kestrel-lumber', withChanges(kestrel, changes), 'pickup', 260);
      const windows = scheduledWindows([bluestoneTrip, blocked], afterCutoff);
      assert.equal(windows.length, 37);
      for (const window of windows) assert.equal(window.available ? null : window.reason, reason, window.id);
      assert.equal(earliestWindow([bluestoneTrip, blocked], afterCutoff), null);
    }
  });

  it('lets the calendar and the clock alone decide when the order has no stores', () => {
    // A re-attempt: the load is already on the truck.
    const reattempt = scheduledWindows([], at(THU, '12:25'));
    assert.equal(reattempt.length, 37);
    for (const slot of ['07:00', '09:00', '11:00']) {
      assert.equal(reasonOf(reattempt, `${THU}T${slot}`), 'No longer available');
    }
    assert.equal(reasonOf(reattempt, `${THU}T13:00`), 'Too soon — earliest 1:55 pm');
    assert.deepEqual(available(reattempt, `${THU}T15:00`), {
      id: `${THU}T15:00`,
      kind: 'scheduled',
      date: THU,
      startAt: at(THU, '15:00'),
      label: 'Today, 3–5 pm',
      available: true,
      endAt: at(THU, '17:00'),
      reason: null,
      stores: [],
    });
    // No store hours and no cut-off apply: Sunday works, and so does 17:00 after 15:00.
    assert.equal(reattempt.filter((window) => window.available).length, 37 - 4);
    assert.ok(available(scheduledWindows([], at(THU, '15:10')), `${THU}T17:00`));
    // Holidays still apply.
    const christmas = scheduledWindows([], at('2026-12-23', '10:00'));
    assert.equal(reasonOf(christmas, '2026-12-25T09:00'), 'Holiday — no deliveries');
    assert.equal(christmas.filter((window) => window.available).length, 3 + 6 + 3 + 6);
    assert.equal(earliestWindow([], at(THU, '12:25'))?.id, `${THU}T15:00`);
  });
});

// ---------- resolveWindow, earliestWindow, labels ----------

describe('resolveWindow (§4.7)', () => {
  const stores = [kestrelTrip, bluestoneTrip];

  it('returns exactly the option that is listed under the id', () => {
    for (const now of [at(THU, '12:25'), at(THU, '15:10'), at(SAT, '12:26'), at('2026-12-23', '10:00')]) {
      const listed = scheduledWindows(stores, now);
      for (const window of listed) assert.deepEqual(resolveWindow(window.id, stores, now), window, window.id);
      assert.deepEqual(resolveWindow('asap', stores, now), asapWindow(stores, now));
    }
  });

  it('tells the server whether the chosen window still works', () => {
    const chosen = `${THU}T15:00`;
    assert.equal(resolveWindow(chosen, stores, at(THU, '12:25'))?.available, true);
    // The customer waited: by 13:31 the window starts in less than 90 minutes.
    const stale = resolveWindow(chosen, stores, at(THU, '13:31'));
    assert.equal(stale?.available, false);
    assert.equal(stale?.reason, 'Too soon — earliest 3:05 pm');
    assert.equal(resolveWindow('asap', stores, at(THU, '12:25'))?.label, 'Today by 1:50 pm');
    assert.equal(resolveWindow('asap', stores, at(THU, '15:10'))?.available, false);
  });

  it('returns null for an id that is not a slot of the next 7 days', () => {
    const now = at(THU, '12:25');
    assert.ok(resolveWindow('2026-11-25T17:00', stores, now));
    for (const id of [
      '2026-11-26T07:00', // day 8
      `${WED}T17:00`, // yesterday
      `${SUN}T08:00`, // Sunday starts at 10:00
      `${SAT}T07:00`, // Saturday starts at 08:00
      `${FRI}T08:00`, // not a slot start
      `${FRI}T07:30`,
      '2026-02-30T07:00',
      `${FRI}T7:00`,
      `${FRI} 07:00`,
      `${FRI}T07:00:00`,
      'ASAP',
      'tomorrow',
      '',
    ]) {
      assert.equal(resolveWindow(id, stores, now), null, id);
    }
    // The horizon moves with the Toronto date.
    assert.ok(resolveWindow('2026-11-26T07:00', stores, at(FRI, '00:00')));
    assert.equal(resolveWindow(`${THU}T17:00`, stores, at(FRI, '00:00')), null);
  });

  it('recognises the form of a window id', () => {
    for (const id of [
      'asap',
      '2026-11-20T07:00',
      '2026-11-22T10:00',
      '2026-11-20T08:30',
      '2028-02-29T23:59',
    ]) {
      assert.ok(isWindowId(id), id);
    }
    for (const bad of [
      'ASAP',
      'asap ',
      '2026-02-30T07:00',
      '2026-11-20T24:00',
      '2026-11-20T07:60',
      '2026-11-20T7:00',
      '2026-11-20 07:00',
      '2026-11-20',
      '07:00',
      '',
      null,
      undefined,
      42,
      {},
    ]) {
      assert.ok(!isWindowId(bad), String(bad));
    }
  });
});

describe('earliestWindow', () => {
  const stores = [kestrelTrip, bluestoneTrip];

  it('is ASAP when ASAP is available', () => {
    const now = at(THU, '12:25');
    assert.deepEqual(earliestWindow(stores, now), asapWindow(stores, now));
    assert.equal(earliestWindow(stores, now)?.id, 'asap');
  });

  it('is otherwise the first slot that works', () => {
    assert.equal(earliestWindow(stores, at(THU, '15:10'))?.id, `${FRI}T07:00`);
    // Saturday 16:30: both stores are closed until Monday.
    const afterSaturday = earliestWindow(stores, at(SAT, '16:30'));
    assert.equal(afterSaturday?.id, `${MON}T07:00`);
    assert.equal(afterSaturday?.label, 'Mon, Nov 23, 7–9 am');
    // Before opening on Thursday the 07–09 window is still more than 90 minutes away.
    assert.equal(earliestWindow(stores, at(THU, '05:00'))?.id, `${THU}T07:00`);
    assert.equal(earliestWindow(stores, at(THU, '05:31'))?.id, `${THU}T09:00`);
  });

  it('is null when nothing works in the next 7 days', () => {
    const closed = trip(
      'kestrel-lumber',
      withChanges(kestrel, { hours: week(null, null, null) }),
      'pickup',
      260,
    );
    assert.equal(earliestWindow([closed], at(THU, '12:25')), null);
  });
});

describe('windowLabel', () => {
  const asap = { kind: 'asap' as const, startAt: null, endAt: at(THU, '13:50') };
  const friday = { kind: 'scheduled' as const, startAt: at(FRI, '07:00'), endAt: at(FRI, '09:00') };

  it('reads "Today by 1:50 pm" for ASAP on the day and dates it afterwards', () => {
    assert.equal(windowLabel(asap, at(THU, '12:25')), 'Today by 1:50 pm');
    assert.equal(windowLabel(asap, at(WED, '22:00')), 'Tomorrow by 1:50 pm');
    assert.equal(windowLabel(asap, at(FRI, '09:00')), 'Thu, Nov 19 by 1:50 pm');
  });

  it('reads the day and the slot for a scheduled window', () => {
    assert.equal(windowLabel(friday, at(THU, '15:10')), 'Tomorrow, 7–9 am');
    assert.equal(windowLabel(friday, at(FRI, '06:00')), 'Today, 7–9 am');
    assert.equal(windowLabel(friday, at('2026-11-16', '09:00')), 'Fri, Nov 20, 7–9 am');
    assert.equal(windowLabel(friday, at(SAT, '09:00')), 'Fri, Nov 20, 7–9 am');
    assert.equal(
      windowLabel(
        { kind: 'scheduled', startAt: at(SAT, '10:00'), endAt: at(SAT, '12:00') },
        at(THU, '15:10'),
      ),
      'Sat, Nov 21, 10 am–12 pm',
    );
  });

  it('accepts dates and shows a dash when the end is missing', () => {
    const asDates = {
      kind: 'scheduled' as const,
      startAt: new Date(friday.startAt),
      endAt: new Date(friday.endAt),
    };
    assert.equal(windowLabel(asDates, at(THU, '15:10')), 'Tomorrow, 7–9 am');
    assert.equal(windowLabel({ kind: 'asap', startAt: null, endAt: null }, at(THU, '12:25')), '—');
    assert.equal(
      windowLabel({ kind: 'scheduled', startAt: friday.startAt, endAt: undefined }, at(THU, '12:25')),
      '—',
    );
    // A scheduled window that lost its start still says when it ends.
    assert.equal(windowLabel({ ...friday, startAt: null }, at(THU, '15:10')), 'Tomorrow by 9:00 am');
    // ASAP is a deadline, never a slot, even if a start time was stored with it.
    assert.equal(windowLabel({ ...asap, startAt: at(THU, '12:25') }, at(THU, '12:25')), 'Today by 1:50 pm');
  });
});

// ---------- pickup ----------

describe('pickup (§4.5)', () => {
  it('reproduces the §4.8 example at Copperline', () => {
    // Ordered 12:25, prep 15: ready 12:40, held until Friday's closing time.
    assert.deepEqual(pickupReady(copperline, at(THU, '12:25')), {
      ok: true,
      readyAt: at(THU, '12:40'),
      holdUntil: at(FRI, '17:00'),
      label: 'Ready in 15 min',
    });
    // Ordered 16:50: 17:05 is past 16:45 (15 minutes before closing), so Friday 07:00 + 15.
    assert.deepEqual(pickupReady(copperline, at(THU, '16:50')), {
      ok: true,
      readyAt: at(FRI, '07:15'),
      holdUntil: at(SAT, '14:00'),
      label: 'Ready tomorrow 7:15 am',
    });
  });

  it('is ready today only if that leaves 15 minutes before closing', () => {
    assert.deepEqual(pickupReady(copperline, at(THU, '16:30')), {
      ok: true,
      readyAt: at(THU, '16:45'),
      holdUntil: at(FRI, '17:00'),
      label: 'Ready in 15 min',
    });
    const justLate = pickupReady(copperline, at(THU, '16:30') + 1);
    assert.ok(justLate.ok);
    sameInstant(justLate.readyAt, at(FRI, '07:15'));
  });

  it('rounds the ready time up to 5 minutes and counts the label from now', () => {
    const odd = pickupReady(copperline, at(THU, '12:27'));
    assert.ok(odd.ok);
    sameInstant(odd.readyAt, at(THU, '12:45'));
    assert.equal(odd.label, 'Ready in 18 min');
    const withSeconds = pickupReady(copperline, at(THU, '12:25') + 30 * SECOND);
    assert.ok(withSeconds.ok);
    sameInstant(withSeconds.readyAt, at(THU, '12:45'));
    assert.equal(withSeconds.label, 'Ready in 20 min');
    const fromKestrel = pickupReady(kestrel, at(THU, '12:25'));
    assert.ok(fromKestrel.ok);
    sameInstant(fromKestrel.readyAt, at(THU, '12:50'));
    assert.equal(fromKestrel.label, 'Ready in 25 min');
  });

  it('has no cut-off: an order placed while the store is closed is ready after it opens', () => {
    const cases: [number, number, number, string][] = [
      // Before opening: the same day, and the label needs no day.
      [at(THU, '05:00'), at(THU, '07:15'), at(FRI, '17:00'), 'Ready 7:15 am'],
      [at(THU, '23:30'), at(FRI, '07:15'), at(SAT, '14:00'), 'Ready tomorrow 7:15 am'],
      // Saturday opens at 08:00; the hold then runs to Monday's closing time.
      [at(FRI, '16:50'), at(SAT, '08:15'), at(MON, '17:00'), 'Ready tomorrow 8:15 am'],
      [at(SAT, '13:50'), at(MON, '07:15'), at(TUE, '17:00'), 'Ready Mon 7:15 am'],
      [at(SUN, '12:00'), at(MON, '07:15'), at(TUE, '17:00'), 'Ready tomorrow 7:15 am'],
      // Christmas: closed Fri, Sat, Sun and Mon.
      [at('2026-12-24', '16:50'), at('2026-12-29', '07:15'), at('2026-12-30', '17:00'), 'Ready Tue 7:15 am'],
    ];
    for (const [now, readyAt, holdUntil, label] of cases) {
      assert.deepEqual(pickupReady(copperline, now), { ok: true, readyAt, holdUntil, label }, stamp(now));
    }
  });

  it('writes the date once the day is a week or more away', () => {
    const closedUntil = (lastClosed: string) => {
      const closures: string[] = [];
      for (let date = FRI; date <= lastClosed; date = addLocalDays(date, 1)) closures.push(date);
      return withChanges(copperline, { closures });
    };
    const now = at(THU, '16:50');
    // Reopening on Wednesday the 25th, six days away: the weekday is enough.
    const sixDays = pickupReady(closedUntil(TUE), now);
    assert.ok(sixDays.ok);
    assert.equal(sixDays.label, 'Ready Wed 7:15 am');
    // Next Thursday must not read like today.
    const sevenDays = pickupReady(closedUntil('2026-11-25'), now);
    assert.ok(sevenDays.ok);
    sameInstant(sevenDays.readyAt, at('2026-11-26', '07:15'));
    assert.equal(sevenDays.label, 'Ready Thu, Nov 26, 7:15 am');
    const nineDays = pickupReady(closedUntil('2026-11-27'), now);
    assert.ok(nineDays.ok);
    assert.equal(nineDays.label, 'Ready Sat, Nov 28, 8:15 am');
  });

  it('follows the rule as written when the prep time is longer than the next open day', () => {
    // §4.5 says roundUp5(next opening + prep). With 4 hours of prep and a Saturday of 09:00–13:00 that
    // is closing time itself (reported as a gap in the spec); the hold still runs to Monday.
    const special = withChanges(glassmoor, { prepMinutes: 240 });
    assert.deepEqual(pickupReady(special, at(FRI, '16:50')), {
      ok: true,
      readyAt: at(SAT, '13:00'),
      holdUntil: at(MON, '17:00'),
      label: 'Ready tomorrow 1:00 pm',
    });
  });

  it('is refused by a store that cannot take a pickup order', () => {
    const now = at(THU, '12:25');
    const cases: [Partial<TimingStore>, string][] = [
      [{ status: 'onboarding' }, "Copperline isn't taking orders"],
      [{ acceptingOrders: false }, 'Copperline has paused new orders'],
      [
        { fulfilment: { delivery: true, pickup: false, deliveryRadiusKm: 40 } },
        "Copperline doesn't offer pickup",
      ],
      [{ hours: week(null, null, null) }, 'Copperline has no opening hours in the next 14 days'],
      [{ prepMinutes: Number.NaN }, "Copperline isn't taking orders"],
    ];
    for (const [changes, reason] of cases) {
      assert.deepEqual(pickupReady(withChanges(copperline, changes), now), { ok: false, reason });
    }
    // A store that only does pickup is fine.
    const pickupOnly = withChanges(copperline, {
      fulfilment: { delivery: false, pickup: true, deliveryRadiusKm: 40 },
    });
    assert.equal(pickupReady(pickupOnly, now).ok, true);
  });

  it('holds a ready order until closing time of the next open day', () => {
    sameInstant(pickupHoldUntil(copperline, at(THU, '12:40')), at(FRI, '17:00'));
    sameInstant(pickupHoldUntil(copperline, at(THU, '23:59')), at(FRI, '17:00'));
    sameInstant(pickupHoldUntil(copperline, at(FRI, '00:00')), at(SAT, '14:00'));
    sameInstant(pickupHoldUntil(copperline, at(FRI, '07:15')), at(SAT, '14:00'));
    // Saturday → Monday (closed Sunday); Grainline is open on Sunday.
    sameInstant(pickupHoldUntil(copperline, at(SAT, '10:00')), at(MON, '17:00'));
    sameInstant(pickupHoldUntil(grainline, at(SAT, '10:00')), at(SUN, '16:00'));
    // Holidays and closures push it on.
    sameInstant(pickupHoldUntil(copperline, at('2026-12-24', '12:40')), at('2026-12-29', '17:00'));
    sameInstant(pickupHoldUntil(glassmoor, at('2026-11-26', '10:00')), at('2026-11-28', '13:00'));
  });

  it('has no hold when the store does not open in the following 14 days', () => {
    const closures = Array.from({ length: 14 }, (_, index) => addLocalDays(FRI, index));
    const everyDay = week('07:00-17:00', '07:00-17:00', '07:00-17:00');
    assert.equal(
      pickupHoldUntil(withChanges(copperline, { hours: everyDay, closures }), at(THU, '12:40')),
      null,
    );
    sameInstant(
      pickupHoldUntil(
        withChanges(copperline, { hours: everyDay, closures: closures.slice(0, 13) }),
        at(THU, '12:40'),
      ),
      at('2026-12-03', '17:00'),
    );
    const marked = pickupReady(withChanges(copperline, { hours: everyDay, closures }), at(THU, '12:25'));
    assert.deepEqual(marked, {
      ok: true,
      readyAt: at(THU, '12:40'),
      holdUntil: null,
      label: 'Ready in 15 min',
    });
  });
});

// ---------- clocks ----------

describe('store respondBy (§2.1, §4.6)', () => {
  it('gives an open store 10 minutes: 12:35, reminder 12:30, auto-reject 12:55 (§4.8)', () => {
    const respondBy = storeRespondBy(kestrel, at(THU, '12:25'));
    sameInstant(respondBy, at(THU, '12:35'));
    sameInstant(respondBy - STORE_REMINDER_BEFORE_MIN * MINUTE, at(THU, '12:30'));
    sameInstant(respondBy + STORE_AUTO_REJECT_AFTER_MIN * MINUTE, at(THU, '12:55'));
    // ASAP offers open at acceptance: the pickup is far less than 12 hours away.
    const acceptedAt = at(THU, '12:31');
    sameInstant(offerOpensAt(at(THU, '12:50'), acceptedAt), acceptedAt);
  });

  it('starts the 10 minutes at the next opening when the store is closed', () => {
    const cases: [number, number][] = [
      [at(THU, '19:00'), at(FRI, '06:40')],
      [at(THU, '18:00'), at(FRI, '06:40')],
      [at(THU, '05:00'), at(THU, '06:40')],
      [at(THU, '06:30') - 1, at(THU, '06:40')],
      [at(FRI, '23:30'), at(SAT, '07:10')],
      [at(SAT, '16:00'), at(MON, '06:40')],
      [at(SUN, '12:00'), at(MON, '06:40')],
      [at('2026-12-24', '18:30'), at('2026-12-29', '06:40')],
      [at('2026-12-25', '10:00'), at('2026-12-29', '06:40')],
    ];
    for (const [now, respondBy] of cases) sameInstant(storeRespondBy(kestrel, now), respondBy, stamp(now));
    sameInstant(storeRespondBy(glassmoor, at('2026-11-27', '10:00')), at('2026-11-28', '09:10'));
  });

  it('counts from now at the edges of the opening hours', () => {
    sameInstant(storeRespondBy(kestrel, at(THU, '06:30')), at(THU, '06:40'));
    // Still open one millisecond before closing: the clock runs past closing time.
    assert.equal(storeRespondBy(kestrel, at(THU, '18:00') - 1), at(THU, '18:10') - 1);
  });

  it('counts from now when the store has no opening in sight', () => {
    const noHours = withChanges(kestrel, { hours: week(null, null, null) });
    sameInstant(storeRespondBy(noHours, at(THU, '12:25')), at(THU, '12:35'));
  });
});

describe('offerOpensAt (§2.4, §4.4)', () => {
  it('is 12 hours before the target pickup, but never before acceptance', () => {
    sameInstant(offerOpensAt(at(FRI, '06:30'), at(THU, '15:12')), at(THU, '18:30'));
    sameInstant(offerOpensAt(at(FRI, '08:03'), at(THU, '15:12')), at(THU, '20:03'));
    sameInstant(offerOpensAt(at(FRI, '06:30'), at(THU, '18:30')), at(THU, '18:30'));
    assert.equal(offerOpensAt(at(FRI, '06:30'), at(THU, '18:30') + 1), at(THU, '18:30') + 1);
    sameInstant(offerOpensAt(at(FRI, '06:30'), at(FRI, '06:00')), at(FRI, '06:00'));
    sameInstant(offerOpensAt(at(THU, '14:03'), at(THU, '12:31')), at(THU, '12:31'));
    assert.equal(OFFER_LEAD_MIN * MINUTE, 12 * HOUR);
  });

  it('counts 12 real hours across a clock change', () => {
    // Sunday 2026-11-01 10:00 EST is 15:00Z; 12 hours earlier it was Saturday 23:00 EDT.
    sameInstant(
      offerOpensAt(at('2026-11-01', '10:00'), at('2026-10-31', '15:00')),
      at('2026-10-31', '23:00'),
    );
    assert.equal(at('2026-11-01', '10:00') - at('2026-10-31', '23:00'), 12 * HOUR);
    // Sunday 2026-03-08 10:00 EDT is 14:00Z; 12 hours earlier it was Saturday 21:00 EST.
    sameInstant(
      offerOpensAt(at('2026-03-08', '10:00'), at('2026-03-07', '15:00')),
      at('2026-03-07', '21:00'),
    );
  });
});

describe('quote respondBy (§4.6)', () => {
  it('is 30 minutes from now inside support hours', () => {
    sameInstant(quoteRespondBy(at(THU, '12:25')), at(THU, '12:55'));
    sameInstant(quoteRespondBy(at(THU, '07:00')), at(THU, '07:30'));
    sameInstant(quoteRespondBy(at(THU, '17:59')), at(THU, '18:29'));
    sameInstant(quoteRespondBy(at(SAT, '13:59')), at(SAT, '14:29'));
  });

  it('is 30 minutes after support next opens otherwise', () => {
    const cases: [number, number][] = [
      // Mon–Fri 07:00–18:00, Sat 08:00–14:00.
      [at(THU, '18:00'), at(FRI, '07:30')],
      [at(THU, '06:00'), at(THU, '07:30')],
      [at(THU, '23:45'), at(FRI, '07:30')],
      [at(FRI, '18:30'), at(SAT, '08:30')],
      [at(SAT, '14:00'), at(MON, '07:30')],
      [at(SUN, '10:00'), at(MON, '07:30')],
    ];
    for (const [now, respondBy] of cases) sameInstant(quoteRespondBy(now), respondBy, stamp(now));
  });

  it('keeps support hours on the platform holidays, which close fulfilment only (§4.2, §4.6)', () => {
    const cases: [number, number][] = [
      // Christmas (Fri), Boxing Day (Sat), the Monday in lieu, New Year's Day (Fri).
      [at('2026-12-24', '18:30'), at('2026-12-25', '07:30')],
      [at('2026-12-25', '10:00'), at('2026-12-25', '10:30')],
      [at('2026-12-26', '09:00'), at('2026-12-26', '09:30')],
      [at('2026-12-28', '10:00'), at('2026-12-28', '10:30')],
      [at('2026-12-31', '18:30'), at('2027-01-01', '07:30')],
      [at('2027-01-01', '10:00'), at('2027-01-01', '10:30')],
    ];
    for (const [now, respondBy] of cases) sameInstant(quoteRespondBy(now), respondBy, stamp(now));
    // The same days are closed for a store that keeps the same hours.
    const support = { hours: SUPPORT_HOURS, closures: [] };
    assert.equal(storeHoursOn(support, '2026-12-25'), null);
    sameInstant(storeRespondBy(support, at('2026-12-25', '10:00')), at('2026-12-29', '07:10'));
  });
});

// ---------- store cards ----------

describe('storeAvailability (§2.8, §7.3)', () => {
  const now = at(THU, '12:25');
  const toSite = { vehicleClass: 'pickup', roadTenths: 260 } as const;

  it('promises "Delivery by 1:50 pm" when the store can deliver to the site now', () => {
    assert.deepEqual(storeAvailability(kestrel, toSite, now), {
      openNow: true,
      opensAt: null,
      closesAt: at(THU, '18:00'),
      badge: null,
      promise: 'Delivery by 1:50 pm',
      deliverBy: at(THU, '13:50'),
      pickupReadyAt: at(THU, '12:50'),
    });
  });

  it('promises "Pickup ready in 25 min" when there is no site, no delivery or no same-day delivery left', () => {
    const pickupOnly = {
      openNow: true,
      opensAt: null,
      closesAt: at(THU, '18:00'),
      badge: null,
      promise: 'Pickup ready in 25 min',
      deliverBy: null,
      pickupReadyAt: at(THU, '12:50'),
    };
    assert.deepEqual(storeAvailability(kestrel, null, now), pickupOnly);
    // Kestrel delivers within 45 km: 45.1 km is out, 45.0 km is in (72 min: by 2:20 pm).
    assert.deepEqual(
      storeAvailability(kestrel, { vehicleClass: 'pickup', roadTenths: 451 }, now),
      pickupOnly,
    );
    const atTheEdge = storeAvailability(kestrel, { vehicleClass: 'pickup', roadTenths: 450 }, now);
    assert.equal(atTheEdge.promise, 'Delivery by 2:20 pm');
    sameInstant(atTheEdge.deliverBy, at(THU, '14:20'));
    const noDelivery = withChanges(kestrel, {
      fulfilment: { delivery: false, pickup: true, deliveryRadiusKm: 45 },
    });
    assert.deepEqual(storeAvailability(noDelivery, toSite, now), pickupOnly);
    // After the 15:00 cut-off.
    const afterCutoff = storeAvailability(kestrel, toSite, at(THU, '15:10'));
    assert.equal(afterCutoff.promise, 'Pickup ready in 25 min');
    assert.equal(afterCutoff.deliverBy, null);
    sameInstant(afterCutoff.pickupReadyAt, at(THU, '15:35'));
  });

  it('shows "Closed · opens 7:00 am" and "Opens tomorrow 6:30 am" outside the opening hours', () => {
    assert.deepEqual(storeAvailability(kestrel, toSite, at(THU, '19:00')), {
      openNow: false,
      opensAt: at(FRI, '06:30'),
      closesAt: null,
      badge: 'Closed · opens tomorrow 6:30 am',
      promise: 'Opens tomorrow 6:30 am',
      deliverBy: null,
      pickupReadyAt: at(FRI, '06:55'),
    });
    assert.deepEqual(storeAvailability(copperline, null, at(THU, '05:00')), {
      openNow: false,
      opensAt: at(THU, '07:00'),
      closesAt: null,
      badge: 'Closed · opens 7:00 am',
      promise: 'Opens 7:00 am',
      deliverBy: null,
      pickupReadyAt: at(THU, '07:15'),
    });
    const weekend = storeAvailability(kestrel, toSite, at(SAT, '16:30'));
    assert.equal(weekend.badge, 'Closed · opens Mon 6:30 am');
    assert.equal(weekend.promise, 'Opens Mon 6:30 am');
    sameInstant(weekend.opensAt, at(MON, '06:30'));
    const holiday = storeAvailability(kestrel, toSite, at('2026-12-25', '10:00'));
    assert.equal(holiday.badge, 'Closed · opens Tue 6:30 am');
    assert.equal(holiday.openNow, false);
  });

  it("promises tomorrow's pickup when today is too short for the prep time", () => {
    // 17:40 + 25 min is past 17:45, 15 minutes before Kestrel closes.
    const late = storeAvailability(kestrel, toSite, at(THU, '17:40'));
    assert.deepEqual(late, {
      openNow: true,
      opensAt: null,
      closesAt: at(THU, '18:00'),
      badge: null,
      promise: 'Pickup ready tomorrow 6:55 am',
      deliverBy: null,
      pickupReadyAt: at(FRI, '06:55'),
    });
  });

  it('shows the badge of a store that is not live and promises "Joining InstaSupply"', () => {
    const blank = { openNow: false, opensAt: null, closesAt: null, deliverBy: null, pickupReadyAt: null };
    assert.deepEqual(storeAvailability(withChanges(kestrel, { status: 'onboarding' }), toSite, now), {
      ...blank,
      badge: 'Onboarding now',
      promise: 'Joining InstaSupply',
    });
    assert.deepEqual(storeAvailability(withChanges(kestrel, { status: 'coming_soon' }), toSite, now), {
      ...blank,
      badge: 'Coming soon',
      promise: 'Joining InstaSupply',
    });
    assert.deepEqual(storeAvailability(withChanges(kestrel, { status: 'closed' }), toSite, now), {
      ...blank,
      badge: 'Closed',
      promise: null,
    });
  });

  it('shows "Paused" and promises nothing while the store has paused new orders', () => {
    const paused = withChanges(kestrel, { acceptingOrders: false });
    assert.deepEqual(storeAvailability(paused, toSite, now), {
      openNow: true,
      opensAt: null,
      closesAt: at(THU, '18:00'),
      badge: 'Paused',
      promise: null,
      deliverBy: null,
      pickupReadyAt: null,
    });
    assert.deepEqual(storeAvailability(paused, toSite, at(THU, '19:00')), {
      openNow: false,
      opensAt: at(FRI, '06:30'),
      closesAt: null,
      badge: 'Paused',
      promise: null,
      deliverBy: null,
      pickupReadyAt: null,
    });
  });

  it('has nothing to promise when an open store can neither deliver today nor offer pickup', () => {
    const deliveryOnly = withChanges(kestrel, {
      fulfilment: { delivery: true, pickup: false, deliveryRadiusKm: 45 },
    });
    assert.equal(storeAvailability(deliveryOnly, toSite, now).promise, 'Delivery by 1:50 pm');
    assert.equal(storeAvailability(deliveryOnly, toSite, now).pickupReadyAt, null);
    assert.deepEqual(storeAvailability(deliveryOnly, toSite, at(THU, '15:10')), {
      openNow: true,
      opensAt: null,
      closesAt: at(THU, '18:00'),
      badge: null,
      promise: null,
      deliverBy: null,
      pickupReadyAt: null,
    });
    assert.equal(storeAvailability(deliveryOnly, toSite, at(THU, '19:00')).promise, 'Opens tomorrow 6:30 am');
  });

  it('shows plain "Closed" for a live store with no opening in sight', () => {
    const noHours = withChanges(kestrel, { hours: week(null, null, null) });
    assert.deepEqual(storeAvailability(noHours, toSite, now), {
      openNow: false,
      opensAt: null,
      closesAt: null,
      badge: 'Closed',
      promise: null,
      deliverBy: null,
      pickupReadyAt: null,
    });
  });
});

// ---------- clock changes and midnight UTC ----------

describe('around the clock changes', () => {
  it('keeps slots and store hours on the wall clock when the clocks go back', () => {
    // Saturday 2026-10-31, 15:30 EDT. Sunday is the 25-hour day.
    const now = at('2026-10-31', '15:30');
    assert.equal(now, Date.UTC(2026, 9, 31, 19, 30));
    const windows = scheduledWindows([kestrelTrip, bluestoneTrip], now);
    assert.equal(windows.length, 37);
    assert.equal(windows[0]?.id, '2026-10-31T08:00');
    assert.equal(windows[windows.length - 1]?.id, '2026-11-06T17:00');
    for (const window of windows)
      assert.equal((window.endAt ?? 0) - (window.startAt ?? 0), 2 * HOUR, window.id);
    assert.equal(option(windows, '2026-10-31T14:00').startAt, Date.UTC(2026, 9, 31, 18)); // 14:00 EDT
    assert.equal(option(windows, '2026-11-01T10:00').startAt, Date.UTC(2026, 10, 1, 15)); // 10:00 EST
    assert.equal(reasonOf(windows, '2026-11-01T10:00'), 'Kestrel and Bluestone are closed Sunday');
    const monday = available(windows, '2026-11-02T07:00');
    assert.equal(monday.startAt, Date.UTC(2026, 10, 2, 12)); // 07:00 EST
    assert.equal(monday.label, 'Mon, Nov 2, 7–9 am');
    assert.equal(monday.stores[0]?.targetPickupAt, Date.UTC(2026, 10, 2, 11, 30)); // 06:30 EST
    // The offer opens 12 real hours before the pickup: Sunday 18:30 EST.
    sameInstant(offerOpensAt(Date.UTC(2026, 10, 2, 11, 30), now + 5 * MINUTE), at('2026-11-01', '18:30'));
    assert.equal(earliestWindow([kestrelTrip, bluestoneTrip], now)?.id, '2026-11-02T07:00');
    sameInstant(storeRespondBy(kestrel, at('2026-10-31', '16:30')), at('2026-11-02', '06:40'));
    assert.equal(storeRespondBy(kestrel, at('2026-10-31', '16:30')), Date.UTC(2026, 10, 2, 11, 40));
  });

  it('opens a Sunday store at 10:00 by the clock on the 25-hour day', () => {
    assert.equal(storeHoursOn(grainline, '2026-10-25')?.openAt, Date.UTC(2026, 9, 25, 14)); // EDT
    assert.equal(storeHoursOn(grainline, '2026-11-01')?.openAt, Date.UTC(2026, 10, 1, 15)); // EST
    assert.equal(storeHoursOn(grainline, '2026-11-01')?.closeAt, Date.UTC(2026, 10, 1, 21));
    const now = at('2026-10-31', '12:00');
    const sunday = available(scheduledWindows([grainlineTrip], now), '2026-11-01T10:00');
    assert.equal(sunday.label, 'Tomorrow, 10 am–12 pm');
    assert.deepEqual(clocks(sunday.stores[0]), ['10:00', '10:00', '12:00']);
    assert.equal(sunday.stores[0]?.targetPickupAt, Date.UTC(2026, 10, 1, 15));
    // Pickup ordered Saturday 16:50 EDT: ready Sunday 10:20 EST, held until Monday 19:00 EST.
    assert.deepEqual(pickupReady(grainline, at('2026-10-31', '16:50')), {
      ok: true,
      readyAt: Date.UTC(2026, 10, 1, 15, 20),
      holdUntil: Date.UTC(2026, 10, 3, 0, 0),
      label: 'Ready tomorrow 10:20 am',
    });
    const fromCopperline = pickupReady(copperline, at('2026-10-31', '13:50'));
    assert.deepEqual(fromCopperline, {
      ok: true,
      readyAt: Date.UTC(2026, 10, 2, 12, 15), // Monday 07:15 EST
      holdUntil: Date.UTC(2026, 10, 3, 22, 0), // Tuesday 17:00 EST
      label: 'Ready Mon 7:15 am',
    });
  });

  it('keeps slots and store hours on the wall clock when the clocks go forward', () => {
    // Saturday 2026-03-07, 16:30 EST; Kestrel closed at 16:00. Sunday is the 23-hour day.
    const now = at('2026-03-07', '16:30');
    assert.equal(now, Date.UTC(2026, 2, 7, 21, 30));
    sameInstant(nextOpeningAt(kestrel, now), at('2026-03-09', '06:30'));
    assert.equal(nextOpeningAt(kestrel, now), Date.UTC(2026, 2, 9, 10, 30)); // 06:30 EDT
    assert.equal(storeRespondBy(kestrel, now), Date.UTC(2026, 2, 9, 10, 40));
    const windows = scheduledWindows([kestrelTrip], now);
    assert.equal(windows.length, 37);
    for (const window of windows)
      assert.equal((window.endAt ?? 0) - (window.startAt ?? 0), 2 * HOUR, window.id);
    assert.equal(option(windows, '2026-03-07T14:00').startAt, Date.UTC(2026, 2, 7, 19)); // 14:00 EST
    assert.equal(option(windows, '2026-03-08T10:00').startAt, Date.UTC(2026, 2, 8, 14)); // 10:00 EDT
    const monday = available(windows, '2026-03-09T07:00');
    assert.equal(monday.startAt, Date.UTC(2026, 2, 9, 11));
    assert.equal(monday.stores[0]?.targetPickupAt, Date.UTC(2026, 2, 9, 10, 30));
    assert.equal(storeHoursOn(grainline, '2026-03-08')?.openAt, Date.UTC(2026, 2, 8, 14)); // 10:00 EDT
    assert.equal(pickupHoldUntil(grainline, at('2026-03-07', '12:00')), Date.UTC(2026, 2, 8, 20)); // 16:00 EDT
    assert.equal(quoteRespondBy(at('2026-03-07', '14:00')), Date.UTC(2026, 2, 9, 11, 30)); // Mon 07:30 EDT
  });

  it('opens a store whose opening time falls in the skipped hour one hour later', () => {
    const nightShift = withChanges(grainline, { hours: week('02:30-06:00', '02:30-06:00', '02:30-06:00') });
    assert.equal(storeHoursOn(nightShift, '2026-03-08')?.openAt, Date.UTC(2026, 2, 8, 7, 30)); // 03:30 EDT
    assert.equal(storeHoursOn(nightShift, '2026-03-08')?.closeAt, Date.UTC(2026, 2, 8, 10, 0));
    assert.equal(storeHoursOn(nightShift, '2026-03-09')?.openAt, Date.UTC(2026, 2, 9, 6, 30)); // 02:30 EDT
    // 02:30–03:15 would open at 03:30 and close at 03:15 that night: nothing is left of it.
    const shortNight = withChanges(grainline, { hours: week('02:30-03:15', '02:30-03:15', '02:30-03:15') });
    assert.equal(storeHoursOn(shortNight, '2026-03-08'), null);
    assert.equal(storeHoursOn(shortNight, '2026-03-07')?.closeAt, Date.UTC(2026, 2, 7, 8, 15)); // 03:15 EST
    sameInstant(nextOpeningAt(shortNight, at('2026-03-07', '12:00')), at('2026-03-09', '02:30'));
    // When the clocks go back, 01:30–01:45 is the first of the two quarter hours (EDT).
    const repeated = withChanges(grainline, { hours: week('01:30-01:45', '01:30-01:45', '01:30-01:45') });
    assert.equal(storeHoursOn(repeated, '2026-11-01')?.openAt, Date.UTC(2026, 10, 1, 5, 30));
    assert.equal(storeHoursOn(repeated, '2026-11-01')?.closeAt, Date.UTC(2026, 10, 1, 5, 45));
  });
});

describe('around midnight UTC', () => {
  it('still counts Thursday evening as Thursday (00:10 UTC on Friday)', () => {
    const now = Date.UTC(2026, 10, 20, 0, 10);
    assert.equal(stamp(now), `${THU} 19:10`);
    const asap = asapWindow([kestrelTrip], now);
    assert.equal(asap.date, THU);
    assert.equal(asap.reason, 'Kestrel is closed right now');
    const windows = scheduledWindows([kestrelTrip], now);
    assert.equal(windows[0]?.id, `${THU}T07:00`);
    assert.equal(windows[windows.length - 1]?.id, '2026-11-25T17:00');
    assert.equal(reasonOf(windows, `${THU}T17:00`), 'No longer available');
    assert.equal(available(windows, `${FRI}T07:00`).label, 'Tomorrow, 7–9 am');
    assert.equal(earliestWindow([kestrelTrip], now)?.id, `${FRI}T07:00`);
    assert.deepEqual(pickupReady(copperline, now), {
      ok: true,
      readyAt: at(FRI, '07:15'),
      holdUntil: at(SAT, '14:00'),
      label: 'Ready tomorrow 7:15 am',
    });
    sameInstant(storeRespondBy(kestrel, now), at(FRI, '06:40'));
    sameInstant(quoteRespondBy(now), at(FRI, '07:30'));
    assert.equal(storeAvailability(kestrel, null, now).badge, 'Closed · opens tomorrow 6:30 am');
    assert.equal(resolveWindow('2026-11-26T07:00', [kestrelTrip], now), null);
  });

  it('turns the day at Toronto midnight, 05:00 UTC in winter', () => {
    // 04:30 UTC on Thursday is still Wednesday 23:30 in Toronto.
    const lateWednesday = Date.UTC(2026, 10, 19, 4, 30);
    const before = scheduledWindows([kestrelTrip], lateWednesday);
    assert.equal(before[0]?.id, `${WED}T07:00`);
    assert.equal(available(before, `${THU}T07:00`).label, 'Tomorrow, 7–9 am');
    assert.deepEqual(clocks(available(before, `${THU}T07:00`).stores[0]), ['06:30', '06:30', '09:00']);
    assert.equal(resolveWindow('2026-11-25T07:00', [kestrelTrip], lateWednesday), null);

    const midnight = Date.UTC(2026, 10, 19, 5, 0);
    const after = scheduledWindows([kestrelTrip], midnight);
    assert.equal(after[0]?.id, `${THU}T07:00`);
    // Today now: the store needs its prep time, but it is not open before 06:30 anyway.
    assert.equal(available(after, `${THU}T07:00`).label, 'Today, 7–9 am');
    assert.deepEqual(clocks(available(after, `${THU}T07:00`).stores[0]), ['06:30', '06:30', '09:00']);
    assert.ok(resolveWindow('2026-11-25T07:00', [kestrelTrip], midnight));
  });

  it('turns the day at 04:00 UTC in summer, also on a holiday', () => {
    // 00:10 UTC on July 2 is 20:10 on Canada Day in Toronto.
    const now = Date.UTC(2026, 6, 2, 0, 10);
    assert.equal(stamp(now), '2026-07-01 20:10');
    const windows = scheduledWindows([kestrelTrip], now);
    assert.equal(windows[0]?.id, '2026-07-01T07:00');
    assert.equal(reasonOf(windows, '2026-07-01T17:00'), 'Holiday — no deliveries');
    assert.equal(available(windows, '2026-07-02T07:00').label, 'Tomorrow, 7–9 am');
    assert.equal(available(windows, '2026-07-02T07:00').startAt, Date.UTC(2026, 6, 2, 11)); // 07:00 EDT
    sameInstant(storeRespondBy(kestrel, now), at('2026-07-02', '06:40'));
  });
});

// ---------- properties ----------

describe('properties over random orders and times', () => {
  const shops: [string, TimingStore][] = [
    ['kestrel-lumber', kestrel],
    ['grainline-building', grainline],
    ['bluestone-drywall', bluestone],
    ['voltway-electrical', voltway],
    ['copperline-plumbing', copperline],
    ['aircrest-hvac', aircrest],
    ['boltbin-hardware', boltbin],
    ['glassmoor-glass', glassmoor],
  ];
  const classes = Object.keys(VEHICLE_CLASSES) as VehicleClass[];
  // Ordinary weeks, both clock changes, the Christmas holidays and Glassmoor's stock-take.
  const periods: [string, number][] = [
    ['2026-11-16', 14],
    ['2026-10-28', 8],
    ['2027-03-10', 8],
    ['2026-12-20', 14],
  ];

  /** Random times and orders from one seed. Each test has its own, so it gives the same cases when run alone. */
  function sampler(seed: number) {
    const random = mulberry32(seed);
    const pick = <T>(items: readonly T[]): T => {
      const item = items[Math.floor(random() * items.length)];
      assert.ok(item !== undefined);
      return item;
    };
    const tripFrom = ([storeId, source]: [string, TimingStore]): WindowStoreInput => ({
      storeId,
      store: source,
      vehicleClass: pick(classes),
      roadTenths: Math.floor(random() * 451),
    });
    return {
      shop: () => pick(shops),
      trip: () => tripFrom(pick(shops)),
      now(): number {
        const [first, days] = pick(periods);
        const date = addLocalDays(first, Math.floor(random() * days));
        const whole = fromLocal(date, Math.floor(random() * 1440));
        // Half of the time with seconds and milliseconds, as a real clock has.
        return random() < 0.5 ? whole : whole + Math.floor(random() * MINUTE);
      },
      order(): WindowStoreInput[] {
        const count = 1 + Math.floor(random() * 3);
        const chosen = new Map<string, WindowStoreInput>();
        while (chosen.size < count) {
          const input = tripFrom(pick(shops));
          chosen.set(input.storeId, input);
        }
        return [...chosen.values()];
      },
    };
  }

  /** §4.4 written out once more, straight from the spec, as the expected value. */
  function expectedTiming(input: WindowStoreInput, window: WindowOption, now: number): StoreTiming | null {
    assert.ok(window.startAt !== null && window.endAt !== null);
    const hours = storeHoursOn(input.store, window.date);
    if (!hours) return null;
    if (window.startAt < now + 90 * MINUTE) return null;
    const today = window.date === localDateOf(now);
    if (today && now >= at(window.date, input.store.sameDayCutoff)) return null;
    const spec = VEHICLE_CLASSES[input.vehicleClass];
    const load = spec.loadMinutes * MINUTE;
    const drive = Math.ceil((6 * input.roadTenths) / spec.speedKmh) * MINUTE;
    const earliest = today ? Math.max(hours.openAt, now + input.store.prepMinutes * MINUTE) : hours.openAt;
    const latest = Math.min(hours.closeAt - load, window.endAt - load - drive);
    if (earliest > latest) return null;
    const targetPickupAt = Math.min(Math.max(window.startAt - load - drive, earliest), latest);
    return {
      storeId: input.storeId,
      readyBy: Math.max(earliest, targetPickupAt - 15 * MINUTE),
      targetPickupAt,
      deliverBy: window.endAt,
    };
  }

  it('lists scheduled windows that follow §4.4 for every store, and resolves each one to itself', () => {
    const sample = sampler(20261119);
    let availableCount = 0;
    let unavailableCount = 0;
    for (let round = 0; round < 250; round++) {
      const now = sample.now();
      const order = sample.order();
      const today = localDateOf(now);
      const windows = scheduledWindows(order, now);
      const context = `${stamp(now)} ${order.map((input) => `${input.storeId}/${input.vehicleClass}/${input.roadTenths}`).join(' ')}`;

      // The horizon is today + 6 days, in time order, without duplicates.
      assert.equal(windows[0]?.date, today, context);
      assert.equal(windows[windows.length - 1]?.date, addLocalDays(today, 6), context);
      assert.equal(new Set(windows.map((window) => window.id)).size, windows.length, context);
      for (let index = 1; index < windows.length; index++) {
        assert.ok((windows[index]?.startAt ?? 0) > (windows[index - 1]?.startAt ?? 0), context);
      }

      for (const window of windows) {
        const where = `${context} → ${window.id}`;
        assert.ok(isWindowId(window.id), where);
        assert.deepEqual(resolveWindow(window.id, order, now), window, where);
        const expected = order.map((input) => expectedTiming(input, window, now));
        const works = !ONTARIO_HOLIDAYS.includes(window.date) && expected.every((timing) => timing !== null);
        assert.equal(window.available, works, where);
        if (!window.available) {
          unavailableCount += 1;
          assert.ok(window.reason.length > 0, where);
          assert.deepEqual(window.stores, [], where);
          continue;
        }
        availableCount += 1;
        assert.deepEqual(window.stores, expected, where);
        assert.ok(window.startAt !== null && window.startAt >= now + 90 * MINUTE, where);
        // What the numbers mean on the ground.
        window.stores.forEach((timing, index) => {
          const input = order[index];
          assert.ok(input, where);
          const spec = VEHICLE_CLASSES[input.vehicleClass];
          const loaded = timing.targetPickupAt + spec.loadMinutes * MINUTE;
          const arrives = loaded + Math.ceil((6 * input.roadTenths) / spec.speedKmh) * MINUTE;
          assert.ok(
            isStoreOpenAt(input.store, timing.targetPickupAt),
            `${where}: pickup while the store is open`,
          );
          assert.ok(isStoreOpenAt(input.store, loaded - 1), `${where}: loaded before closing`);
          assert.ok(arrives <= window.endAt, `${where}: on site before the window ends`);
          assert.ok(timing.readyBy <= timing.targetPickupAt, `${where}: ready before the pickup`);
          assert.ok(isStoreOpenAt(input.store, timing.readyBy), `${where}: ready while the store is open`);
          assert.ok(timing.readyBy >= timing.targetPickupAt - 15 * MINUTE, where);
          if (window.date === today) {
            assert.ok(
              timing.readyBy >= now + input.store.prepMinutes * MINUTE,
              `${where}: after the prep time`,
            );
          }
        });
      }

      // The earliest window is ASAP, or else the first available slot.
      const asap = asapWindow(order, now);
      const first = windows.find((window) => window.available) ?? null;
      assert.deepEqual(earliestWindow(order, now), asap.available ? asap : first, context);
    }
    // The sample must exercise both outcomes many times over.
    assert.ok(availableCount > 2_000, String(availableCount));
    assert.ok(unavailableCount > 2_000, String(unavailableCount));
  });

  it('promises ASAP exactly when §4.3 allows it', () => {
    const sample = sampler(43);
    let promised = 0;
    for (let round = 0; round < 3_000; round++) {
      const now = sample.now();
      const input = sample.trip();
      const { storeId, store: source } = input;
      const context = `${stamp(now)} ${storeId}/${input.vehicleClass}/${input.roadTenths}`;
      const today = localDateOf(now);
      const hours = storeHoursOn(source, today);
      const spec = VEHICLE_CLASSES[input.vehicleClass];
      const pickupAt = now + Math.max(source.prepMinutes, 15) * MINUTE;
      const arrives =
        pickupAt + spec.loadMinutes * MINUTE + Math.ceil((6 * input.roadTenths) / spec.speedKmh) * MINUTE;
      const deliverBy = Math.ceil(arrives / (5 * MINUTE)) * 5 * MINUTE;
      const allowed =
        hours !== null &&
        now >= hours.openAt &&
        now < hours.closeAt &&
        now < at(today, source.sameDayCutoff) &&
        pickupAt + spec.loadMinutes * MINUTE <= hours.closeAt &&
        deliverBy <= at(today, '19:00');

      const promise = asapPromise(input, now);
      assert.equal(promise.ok, allowed, context);
      if (!promise.ok) {
        assert.equal(promise.storeId, storeId);
        assert.ok(promise.reason.length > 0);
        continue;
      }
      promised += 1;
      assert.deepEqual(
        promise.timing,
        { storeId, readyBy: now + source.prepMinutes * MINUTE, targetPickupAt: pickupAt, deliverBy },
        context,
      );
      assert.equal(promise.timing.deliverBy % (5 * MINUTE), 0, context);
      assert.equal(localDateOf(promise.timing.deliverBy), today, context);
      assert.equal(asapWindow([input], now).label, `Today by ${formatClockET(deliverBy)}`, context);
    }
    assert.ok(promised > 300, String(promised));
  });

  it('gives pickup, hold and respond-by times that make sense at any moment', () => {
    const sample = sampler(45);
    for (let round = 0; round < 3_000; round++) {
      const now = sample.now();
      const [storeId, source] = sample.shop();
      const context = `${stamp(now)} ${storeId}`;
      const open = isStoreOpenAt(source, now);

      const next = nextOpeningAt(source, now);
      assert.ok(next !== null && next > now, context);
      assert.equal(storeHoursOn(source, localDateOf(next))?.openAt, next, context);
      assert.ok(isStoreOpenAt(source, next) && !isStoreOpenAt(source, next - 1), context);

      const respondBy = storeRespondBy(source, now);
      assert.equal(respondBy, (open ? now : next) + 10 * MINUTE, context);

      const pickup = pickupReady(source, now);
      assert.ok(pickup.ok, context);
      assert.equal(pickup.readyAt % (5 * MINUTE), 0, context);
      assert.ok(pickup.readyAt >= now + source.prepMinutes * MINUTE, context);
      // The seed stores prepare in 30 minutes at most, so the order is ready during opening hours,
      // with at least 15 minutes left to collect it.
      const readyDay = storeHoursOn(source, localDateOf(pickup.readyAt));
      assert.ok(readyDay !== null && pickup.readyAt >= readyDay.openAt, context);
      assert.ok(readyDay.closeAt - pickup.readyAt >= 15 * MINUTE, context);
      // §4.5: prepared right away if the store is open and that leaves 15 minutes before closing,
      // otherwise first thing after the next opening.
      const todayHours = storeHoursOn(source, localDateOf(now));
      const rightAway =
        open && todayHours !== null && now + source.prepMinutes * MINUTE <= todayHours.closeAt - 15 * MINUTE;
      assert.equal(pickup.readyAt, roundUp5((rightAway ? now : next) + source.prepMinutes * MINUTE), context);
      assert.equal(pickup.label.startsWith('Ready in '), rightAway, `${context}: ${pickup.label}`);
      // The hold ends at a closing time on a later date.
      assert.ok(pickup.holdUntil !== null, context);
      const holdDay = localDateOf(pickup.holdUntil - 1);
      assert.ok(holdDay > localDateOf(pickup.readyAt), context);
      assert.equal(storeHoursOn(source, holdDay)?.closeAt, pickup.holdUntil, context);
      for (
        let date = addLocalDays(localDateOf(pickup.readyAt), 1);
        date < holdDay;
        date = addLocalDays(date, 1)
      ) {
        assert.equal(storeHoursOn(source, date), null, `${context}: ${date} is skipped only when closed`);
      }
    }
  });
});

describe('the package root', () => {
  it('exports every name of fulfilment-time.ts', async () => {
    const root: Record<string, unknown> = await import('../src');
    const names = Object.keys(fulfilmentTime).filter((name) => name !== 'default');
    for (const expected of [
      'asapPromise',
      'scheduledWindows',
      'resolveWindow',
      'pickupReady',
      'storeAvailability',
    ]) {
      assert.ok(names.includes(expected), expected);
    }
    for (const name of names) {
      assert.equal(root[name], (fulfilmentTime as Record<string, unknown>)[name], name);
    }
  });
});
