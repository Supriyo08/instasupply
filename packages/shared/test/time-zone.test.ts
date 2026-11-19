/**
 * Toronto time without `Intl` (§4.1, D14). The source may not use `Intl`; the tests do, as an
 * independent oracle: every hour of 2026–2030 is compared with `Intl.DateTimeFormat` for
 * America/Toronto, and the daylight-saving switches are checked to the second.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { Weekday } from '../src/catalog';
import * as timeZone from '../src/time-zone';
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
  startOfLocalDay,
  toClock,
  toLocal,
  toMillis,
  torontoOffsetMinutes,
  weekdayOf,
  type LocalTime,
} from '../src/time-zone';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** An instant written the way the spec writes it: `utc(2026, 3, 8, 6, 59, 59)` is 2026-03-08T06:59:59Z. */
const utc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  Date.UTC(year, month - 1, day, hour, minute, second);

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

// ---------- the oracle ----------

const TORONTO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Toronto',
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** What the platform's time-zone database says about an instant. */
function oracle(ms: number): LocalTime & { offsetMinutes: number } {
  const parts = new Map(TORONTO.formatToParts(ms).map((part) => [part.type, part.value]));
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.get(type);
    assert.ok(value !== undefined, `Intl gave no ${type}`);
    return value;
  };
  const year = Number(read('year'));
  const month = Number(read('month'));
  const day = Number(read('day'));
  const hour = Number(read('hour')) % 24;
  const minute = Number(read('minute'));
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, Number(read('second')));
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    weekday: read('weekday').slice(0, 3).toLowerCase() as Weekday,
    minutes: hour * 60 + minute,
    // Intl gives whole seconds, so the instant's milliseconds are dropped before comparing.
    offsetMinutes: (wallAsUtc - Math.floor(ms / SECOND) * SECOND) / MINUTE,
  };
}

/** The ten switches of 2026–2030: 2nd Sunday of March 07:00 UTC, 1st Sunday of November 06:00 UTC. */
const SWITCHES = [
  { year: 2026, spring: utc(2026, 3, 8, 7), fall: utc(2026, 11, 1, 6) },
  { year: 2027, spring: utc(2027, 3, 14, 7), fall: utc(2027, 11, 7, 6) },
  { year: 2028, spring: utc(2028, 3, 12, 7), fall: utc(2028, 11, 5, 6) },
  { year: 2029, spring: utc(2029, 3, 11, 7), fall: utc(2029, 11, 4, 6) },
  { year: 2030, spring: utc(2030, 3, 10, 7), fall: utc(2030, 11, 3, 6) },
];

const SWEEP_START = utc(2026, 1, 1);
const SWEEP_END = utc(2030, 12, 31, 23);

describe('torontoOffsetMinutes', () => {
  it('matches the §4.1 vectors to the second', () => {
    assert.equal(torontoOffsetMinutes(utc(2026, 3, 8, 6, 59, 59)), -300);
    assert.equal(torontoOffsetMinutes(utc(2026, 3, 8, 7, 0, 0)), -240);
    assert.equal(torontoOffsetMinutes(utc(2026, 11, 1, 5, 59, 59)), -240);
    assert.equal(torontoOffsetMinutes(utc(2026, 11, 1, 6, 0, 0)), -300);
    // 2027: 2027-03-14T07:00Z and 2027-11-07T06:00Z.
    assert.equal(torontoOffsetMinutes(utc(2027, 3, 14, 6, 59, 59)), -300);
    assert.equal(torontoOffsetMinutes(utc(2027, 3, 14, 7, 0, 0)), -240);
    assert.equal(torontoOffsetMinutes(utc(2027, 11, 7, 5, 59, 59)), -240);
    assert.equal(torontoOffsetMinutes(utc(2027, 11, 7, 6, 0, 0)), -300);
  });

  it('switches at the same millisecond in every year from 2026 to 2030', () => {
    for (const { year, spring, fall } of SWITCHES) {
      assert.equal(torontoOffsetMinutes(spring - 1), -300, `${year} just before spring forward`);
      assert.equal(torontoOffsetMinutes(spring), -240, `${year} spring forward`);
      assert.equal(torontoOffsetMinutes(fall - 1), -240, `${year} just before fall back`);
      assert.equal(torontoOffsetMinutes(fall), -300, `${year} fall back`);
      // Both switches are on a Sunday at 02:00 by the clock that is being left.
      assert.deepEqual(toLocal(spring - 1), { date: localDateOf(spring), weekday: 'sun', minutes: 119 });
      assert.deepEqual(toLocal(fall - 1), { date: localDateOf(fall), weekday: 'sun', minutes: 119 });
    }
  });

  it('is standard time in winter and daylight time in summer', () => {
    assert.equal(torontoOffsetMinutes(utc(2026, 1, 15, 12)), -300);
    assert.equal(torontoOffsetMinutes(utc(2026, 7, 1, 12)), -240);
    assert.equal(torontoOffsetMinutes(utc(2026, 12, 31, 23, 59, 59)), -300);
    assert.equal(torontoOffsetMinutes(utc(2027, 1, 1, 0, 0, 0)), -300);
  });

  it('agrees with Intl for every hour from 2026-01-01 to 2030-12-31', () => {
    let hours = 0;
    let daylightHours = 0;
    for (let ms = SWEEP_START; ms <= SWEEP_END; ms += HOUR) {
      const offset = torontoOffsetMinutes(ms);
      if (offset !== oracle(ms).offsetMinutes) {
        assert.fail(`${new Date(ms).toISOString()}: got ${offset}, Intl says ${oracle(ms).offsetMinutes}`);
      }
      hours += 1;
      if (offset === -240) daylightHours += 1;
    }
    // 5 years with one leap day; daylight time runs 238 days minus the hour skipped in March.
    assert.equal(hours, (5 * 365 + 1) * 24);
    assert.equal(daylightHours, 5 * (238 * 24 - 1));
  });

  it('agrees with Intl for every minute within 3 hours of a switch, and every second within 10', () => {
    for (const { spring, fall } of SWITCHES) {
      for (const at of [spring, fall]) {
        for (let ms = at - 3 * HOUR; ms <= at + 3 * HOUR; ms += MINUTE) {
          assert.equal(torontoOffsetMinutes(ms), oracle(ms).offsetMinutes, new Date(ms).toISOString());
        }
        for (let ms = at - 10 * SECOND; ms <= at + 10 * SECOND; ms += SECOND) {
          assert.equal(torontoOffsetMinutes(ms), oracle(ms).offsetMinutes, new Date(ms).toISOString());
        }
      }
    }
  });
});

describe('toLocal', () => {
  it('reads Thu 2026-11-19 17:25Z as 12:25 in Toronto', () => {
    assert.deepEqual(toLocal(utc(2026, 11, 19, 17, 25)), {
      date: '2026-11-19',
      weekday: 'thu',
      minutes: 745,
    });
    assert.deepEqual(toLocal(utc(2026, 7, 1, 16, 0)), { date: '2026-07-01', weekday: 'wed', minutes: 720 });
  });

  it('keeps the Toronto date near UTC midnight', () => {
    // Thursday evening in Toronto is already Friday in UTC.
    assert.deepEqual(toLocal(utc(2026, 11, 20, 0, 10)), {
      date: '2026-11-19',
      weekday: 'thu',
      minutes: 1150,
    });
    assert.deepEqual(toLocal(utc(2026, 11, 19, 23, 59, 59)), {
      date: '2026-11-19',
      weekday: 'thu',
      minutes: 1139,
    });
    // The Toronto day turns at 05:00 UTC in winter and at 04:00 UTC in summer.
    assert.deepEqual(toLocal(utc(2026, 11, 19, 4, 59, 59)), {
      date: '2026-11-18',
      weekday: 'wed',
      minutes: 1439,
    });
    assert.deepEqual(toLocal(utc(2026, 11, 19, 5, 0, 0)), { date: '2026-11-19', weekday: 'thu', minutes: 0 });
    assert.deepEqual(toLocal(utc(2026, 7, 1, 3, 59, 59)), {
      date: '2026-06-30',
      weekday: 'tue',
      minutes: 1439,
    });
    assert.deepEqual(toLocal(utc(2026, 7, 1, 4, 0, 0)), { date: '2026-07-01', weekday: 'wed', minutes: 0 });
  });

  it('crosses the year end and the leap day on the Toronto calendar', () => {
    assert.deepEqual(toLocal(utc(2027, 1, 1, 4, 59)), { date: '2026-12-31', weekday: 'thu', minutes: 1439 });
    assert.deepEqual(toLocal(utc(2027, 1, 1, 5, 0)), { date: '2027-01-01', weekday: 'fri', minutes: 0 });
    assert.deepEqual(toLocal(utc(2028, 2, 29, 12, 0)), { date: '2028-02-29', weekday: 'tue', minutes: 420 });
    assert.deepEqual(toLocal(utc(2028, 3, 1, 4, 59)), { date: '2028-02-29', weekday: 'tue', minutes: 1439 });
    assert.deepEqual(toLocal(utc(2028, 3, 1, 5, 0)), { date: '2028-03-01', weekday: 'wed', minutes: 0 });
  });

  it('reads the wall clock on both sides of each 2026 switch', () => {
    assert.deepEqual(toLocal(utc(2026, 3, 8, 6, 59)), { date: '2026-03-08', weekday: 'sun', minutes: 119 });
    assert.deepEqual(toLocal(utc(2026, 3, 8, 7, 0)), { date: '2026-03-08', weekday: 'sun', minutes: 180 });
    // 01:30 happens twice on the fall-back day.
    assert.deepEqual(toLocal(utc(2026, 11, 1, 5, 30)), { date: '2026-11-01', weekday: 'sun', minutes: 90 });
    assert.deepEqual(toLocal(utc(2026, 11, 1, 6, 30)), { date: '2026-11-01', weekday: 'sun', minutes: 90 });
    assert.deepEqual(toLocal(utc(2026, 11, 1, 7, 0)), { date: '2026-11-01', weekday: 'sun', minutes: 120 });
  });

  it('drops seconds and milliseconds', () => {
    assert.equal(toLocal(utc(2026, 11, 19, 17, 25, 59) + 999).minutes, 745);
  });

  it('agrees with Intl for every hour from 2026-01-01 to 2030-12-31', () => {
    for (let ms = SWEEP_START; ms <= SWEEP_END; ms += HOUR) {
      const local = toLocal(ms);
      const expected = oracle(ms);
      if (
        local.date !== expected.date ||
        local.weekday !== expected.weekday ||
        local.minutes !== expected.minutes
      ) {
        assert.fail(
          `${new Date(ms).toISOString()}: got ${JSON.stringify(local)}, Intl says ${JSON.stringify(expected)}`,
        );
      }
    }
  });

  it('agrees with Intl at random instants, to the minute', () => {
    const random = mulberry32(20261119);
    for (let i = 0; i < 20_000; i++) {
      const ms = SWEEP_START + Math.floor(random() * (SWEEP_END - SWEEP_START));
      const { offsetMinutes, ...expected } = oracle(ms);
      assert.deepEqual(toLocal(ms), expected, new Date(ms).toISOString());
      assert.equal(torontoOffsetMinutes(ms), offsetMinutes, new Date(ms).toISOString());
    }
  });

  it('refuses a value that is not an instant', () => {
    assert.throws(() => toLocal(Number.NaN), RangeError);
    assert.throws(() => toLocal(Number.POSITIVE_INFINITY), RangeError);
    assert.throws(() => toLocal(9e15), RangeError);
  });
});

describe('fromLocal', () => {
  it('matches the §4.1 vectors', () => {
    assert.equal(fromLocal('2026-03-08', 2 * 60 + 30), utc(2026, 3, 8, 7, 30)); // 03:30 EDT
    assert.equal(fromLocal('2026-11-01', 1 * 60 + 30), utc(2026, 11, 1, 5, 30));
    assert.equal(fromLocal('2026-11-19', 12 * 60 + 25), utc(2026, 11, 19, 17, 25));
  });

  it('moves every minute of the skipped spring hour 60 minutes later', () => {
    for (const [date, switchAt] of [
      ['2026-03-08', utc(2026, 3, 8, 7)],
      ['2027-03-14', utc(2027, 3, 14, 7)],
    ] as const) {
      // 01:59 EST is the last minute before the gap; 03:00 EDT is the first one after it.
      assert.equal(fromLocal(date, 119), switchAt - MINUTE);
      assert.equal(fromLocal(date, 180), switchAt);
      for (let minute = 0; minute < 60; minute++) {
        const resolved = fromLocal(date, 120 + minute);
        assert.equal(resolved, switchAt + minute * MINUTE, `${date} 02:${minute}`);
        // 02:mm does not exist: it reads back as 03:mm, the same instant as asking for 03:mm.
        assert.equal(resolved, fromLocal(date, 180 + minute));
        assert.deepEqual(toLocal(resolved), { date, weekday: 'sun', minutes: 180 + minute });
      }
    }
  });

  it('resolves every minute of the repeated fall hour to its first occurrence (EDT)', () => {
    for (const [date, switchAt] of [
      ['2026-11-01', utc(2026, 11, 1, 6)],
      ['2027-11-07', utc(2027, 11, 7, 6)],
    ] as const) {
      // 00:59 EDT is unambiguous; so is 02:00 EST, an hour after the switch.
      assert.equal(fromLocal(date, 59), switchAt - HOUR - MINUTE);
      assert.equal(fromLocal(date, 120), switchAt + HOUR);
      for (let minute = 0; minute < 60; minute++) {
        const first = fromLocal(date, 60 + minute);
        assert.equal(first, switchAt - HOUR + minute * MINUTE, `${date} 01:${minute}`);
        assert.equal(torontoOffsetMinutes(first), -240);
        // The second 01:mm, in EST, reads the same on the wall clock but is never what fromLocal returns.
        assert.deepEqual(toLocal(first + HOUR), toLocal(first));
        assert.equal(torontoOffsetMinutes(first + HOUR), -300);
      }
    }
  });

  it('round-trips fromLocal(toLocal(x)) for every hour and half-hour of 2026–2030', () => {
    for (const shift of [0, 30 * MINUTE]) {
      let repeated = 0;
      for (let ms = SWEEP_START + shift; ms <= SWEEP_END; ms += HOUR) {
        const local = toLocal(ms);
        const back = fromLocal(local.date, local.minutes);
        if (back === ms) continue;
        // The only instants that do not come back are in the second 01:00–01:59 of a fall-back day:
        // their wall-clock reading resolves to the first occurrence, one hour earlier.
        assert.equal(ms - back, HOUR, new Date(ms).toISOString());
        assert.equal(torontoOffsetMinutes(back), -240);
        assert.equal(torontoOffsetMinutes(ms), -300);
        assert.equal(Math.floor(local.minutes / 60), 1);
        repeated += 1;
      }
      assert.equal(repeated, 5, 'one repeated instant per year on this grid');
    }
  });

  it('round-trips toLocal(fromLocal(date, minutes)) for every quarter hour of 2026 and 2027', () => {
    let skipped = 0;
    for (let date = '2026-01-01'; date <= '2027-12-31'; date = addLocalDays(date, 1)) {
      const weekday = weekdayOf(date);
      for (let minutes = 0; minutes < 1440; minutes += 15) {
        const local = toLocal(fromLocal(date, minutes));
        if (local.minutes === minutes) {
          assert.deepEqual(local, { date, weekday, minutes });
          continue;
        }
        // Only the four quarter hours of each skipped spring hour read back differently: 60 minutes later.
        assert.deepEqual(local, { date, weekday, minutes: minutes + 60 }, `${date} ${minutes}`);
        assert.ok(date === '2026-03-08' || date === '2027-03-14');
        assert.equal(Math.floor(minutes / 60), 2);
        skipped += 1;
      }
    }
    assert.equal(skipped, 8);
  });

  it('runs past midnight by the wall clock, also on 23- and 25-hour days', () => {
    for (let date = '2026-01-01'; date <= '2030-12-31'; date = addLocalDays(date, 1)) {
      assert.equal(fromLocal(date, 1440), startOfLocalDay(addLocalDays(date, 1)), date);
    }
    assert.equal(fromLocal('2026-11-19', -60), utc(2026, 11, 19, 4)); // 23:00 the evening before
  });

  it('refuses a date that is not a real YYYY-MM-DD date', () => {
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '2026-11-00',
      '20261119',
      '2026-11-19T07:00',
      '',
    ]) {
      assert.throws(() => fromLocal(bad, 0), RangeError, bad);
    }
    assert.throws(() => fromLocal('2026-11-19', Number.NaN), RangeError);
  });
});

describe('local dates', () => {
  it('adds calendar days across months, years, leap days and switches', () => {
    assert.equal(addLocalDays('2026-11-19', 1), '2026-11-20');
    assert.equal(addLocalDays('2026-11-19', 0), '2026-11-19');
    assert.equal(addLocalDays('2026-11-19', -19), '2026-10-31');
    assert.equal(addLocalDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addLocalDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addLocalDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addLocalDays('2026-02-28', 1), '2026-03-01');
    assert.equal(addLocalDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addLocalDays('2028-02-29', 1), '2028-03-01');
    assert.equal(addLocalDays('2026-01-01', 365), '2027-01-01');
    // The 23-hour and the 25-hour day are each one calendar day.
    assert.equal(addLocalDays('2026-03-07', 1), '2026-03-08');
    assert.equal(addLocalDays('2026-03-08', 1), '2026-03-09');
    assert.equal(addLocalDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addLocalDays('2026-11-01', 1), '2026-11-02');
  });

  it('undoes itself for random dates and day counts', () => {
    const random = mulberry32(41);
    for (let i = 0; i < 2_000; i++) {
      const date = addLocalDays('2026-01-01', Math.floor(random() * 1826));
      const days = Math.floor(random() * 801) - 400;
      const moved = addLocalDays(date, days);
      assert.ok(isLocalDate(moved), moved);
      assert.equal(addLocalDays(moved, -days), date);
      // `YYYY-MM-DD` dates sort like the calendar.
      assert.equal(moved > date, days > 0);
    }
  });

  it('refuses half days and dates that do not exist', () => {
    assert.throws(() => addLocalDays('2026-11-19', 1.5), RangeError);
    assert.throws(() => addLocalDays('2026-11-31', 1), RangeError);
    assert.throws(() => weekdayOf('2026-02-29'), RangeError);
  });

  it('starts a Toronto day at 05:00 UTC in winter and 04:00 UTC in summer', () => {
    assert.equal(startOfLocalDay('2026-11-19'), utc(2026, 11, 19, 5));
    assert.equal(startOfLocalDay('2026-07-01'), utc(2026, 7, 1, 4));
    // The switch days start on the old offset.
    assert.equal(startOfLocalDay('2026-03-08'), utc(2026, 3, 8, 5));
    assert.equal(startOfLocalDay('2026-11-01'), utc(2026, 11, 1, 4));
  });

  it('gives every day of 2026–2030 its own date, 23, 24 or 25 hours long', () => {
    const lengths = new Map<number, string[]>();
    for (let date = '2026-01-01'; date <= '2030-12-31'; date = addLocalDays(date, 1)) {
      const start = startOfLocalDay(date);
      assert.equal(localDateOf(start), date);
      assert.equal(localDateOf(start - 1), addLocalDays(date, -1));
      assert.equal(toLocal(start).minutes, 0);
      const hours = (startOfLocalDay(addLocalDays(date, 1)) - start) / HOUR;
      lengths.set(hours, [...(lengths.get(hours) ?? []), date]);
    }
    assert.deepEqual(lengths.get(23), ['2026-03-08', '2027-03-14', '2028-03-12', '2029-03-11', '2030-03-10']);
    assert.deepEqual(lengths.get(25), ['2026-11-01', '2027-11-07', '2028-11-05', '2029-11-04', '2030-11-03']);
    assert.equal(lengths.get(24)?.length, 5 * 365 + 1 - 10);
    assert.deepEqual([...lengths.keys()].sort(), [23, 24, 25]);
  });

  it('names the Toronto date of an instant', () => {
    assert.equal(localDateOf(utc(2026, 11, 19, 17, 25)), '2026-11-19');
    assert.equal(localDateOf(utc(2026, 11, 20, 0, 10)), '2026-11-19');
    assert.equal(localDateOf(utc(2026, 11, 20, 5, 0)), '2026-11-20');
  });

  it('knows the weekday of a business date', () => {
    assert.equal(weekdayOf('2026-11-19'), 'thu');
    assert.equal(weekdayOf('2026-11-22'), 'sun');
    assert.equal(weekdayOf('2026-11-23'), 'mon');
    assert.equal(weekdayOf('2026-03-08'), 'sun');
    assert.equal(weekdayOf('2028-02-29'), 'tue');
    for (let date = '2026-01-01'; date <= '2027-12-31'; date = addLocalDays(date, 1)) {
      assert.equal(weekdayOf(date), toLocal(fromLocal(date, 12 * 60)).weekday, date);
    }
  });

  it('accepts only real dates written YYYY-MM-DD', () => {
    for (const good of ['2026-11-19', '2028-02-29', '2026-12-31', '2026-01-01'])
      assert.ok(isLocalDate(good), good);
    for (const bad of [
      '2026-02-29',
      '2026-02-30',
      '2026-04-31',
      '2026-13-01',
      '2026-00-01',
      '2026-01-00',
      '2026-1-5',
      '26-01-05',
      '2026/01/05',
      '2026-01-05 ',
      '2026-01-05T00:00',
      '',
      null,
      undefined,
      20260105,
      new Date(0),
    ]) {
      assert.ok(!isLocalDate(bad), String(bad));
    }
  });
});

describe('clock times', () => {
  it('parses HH:MM between 00:00 and 23:59', () => {
    assert.equal(parseClock('06:30'), 390);
    assert.equal(parseClock('00:00'), 0);
    assert.equal(parseClock('15:00'), 900);
    assert.equal(parseClock('19:00'), 1140);
    assert.equal(parseClock('23:59'), 1439);
  });

  it('returns null for anything else', () => {
    for (const bad of [
      '24:00',
      '7:00',
      '07:60',
      '0700',
      '07:0',
      '07:00:00',
      ' 07:00',
      '07:00 ',
      '7 am',
      '',
      'ab:cd',
    ]) {
      assert.equal(parseClock(bad), null, bad);
    }
    // Store documents are not type-checked at run time.
    assert.equal(parseClock(null as unknown as string), null);
    assert.equal(parseClock(700 as unknown as string), null);
  });

  it('writes minutes back as HH:MM, for every minute of the day', () => {
    assert.equal(toClock(390), '06:30');
    assert.equal(toClock(0), '00:00');
    assert.equal(toClock(1439), '23:59');
    for (let minutes = 0; minutes < 1440; minutes++) assert.equal(parseClock(toClock(minutes)), minutes);
  });

  it('refuses minutes that are not a time of day', () => {
    for (const bad of [-1, 1440, 390.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => toClock(bad), RangeError, String(bad));
    }
  });
});

describe('display helpers', () => {
  const thursday = (hour: number, minute = 0) => fromLocal('2026-11-19', hour * 60 + minute);
  const noon = thursday(12);

  it('formats a clock time like "1:40 pm"', () => {
    assert.equal(formatClockET(thursday(13, 40)), '1:40 pm');
    assert.equal(formatClockET(thursday(13, 50)), '1:50 pm');
    assert.equal(formatClockET(thursday(7, 0)), '7:00 am');
    assert.equal(formatClockET(thursday(7, 15)), '7:15 am');
    assert.equal(formatClockET(thursday(12, 5)), '12:05 pm');
    assert.equal(formatClockET(thursday(0, 0)), '12:00 am');
    assert.equal(formatClockET(thursday(0, 59)), '12:59 am');
    assert.equal(formatClockET(thursday(11, 59)), '11:59 am');
    assert.equal(formatClockET(thursday(12, 0)), '12:00 pm');
    assert.equal(formatClockET(thursday(23, 59)), '11:59 pm');
    // Seconds are not shown and never round a promise up.
    assert.equal(formatClockET(thursday(13, 40) + 59 * SECOND), '1:40 pm');
  });

  it('reads the clock in Toronto, in summer and in winter, whatever the input shape', () => {
    assert.equal(formatClockET(utc(2026, 11, 19, 18, 40)), '1:40 pm');
    assert.equal(formatClockET(utc(2026, 7, 1, 17, 40)), '1:40 pm');
    assert.equal(formatClockET(new Date(utc(2026, 11, 19, 18, 40))), '1:40 pm');
  });

  it('shows a dash for a missing time', () => {
    assert.equal(formatClockET(null), '—');
    assert.equal(formatClockET(undefined), '—');
    assert.equal(formatClockET(Number.NaN), '—');
    assert.equal(formatClockET(new Date(Number.NaN)), '—');
    assert.equal(formatClockET(9e15), '—');
    assert.equal(formatDayET(null, noon), '—');
    assert.equal(formatWindowET(null, noon), '—');
    assert.equal(formatWindowET(noon, undefined), '—');
    assert.equal(formatDateTimeET(undefined), '—');
    assert.equal(formatClockTime('25:00'), '—');
    assert.equal(formatClockTime(''), '—');
  });

  it('formats a stored clock time', () => {
    assert.equal(formatClockTime('18:00'), '6:00 pm');
    assert.equal(formatClockTime('06:30'), '6:30 am');
    assert.equal(formatClockTime('15:00'), '3:00 pm');
    assert.equal(formatClockTime('13:00'), '1:00 pm');
    assert.equal(formatClockTime('00:00'), '12:00 am');
    assert.equal(formatClockTime('12:00'), '12:00 pm');
  });

  it('names the day "Today", "Tomorrow" or "Fri, Nov 20"', () => {
    assert.equal(formatDayET(thursday(13, 50), noon), 'Today');
    assert.equal(formatDayET(thursday(0, 0), noon), 'Today');
    assert.equal(formatDayET(thursday(23, 59), noon), 'Today');
    assert.equal(formatDayET(fromLocal('2026-11-20', 0), noon), 'Tomorrow');
    assert.equal(formatDayET(fromLocal('2026-11-20', 7 * 60), noon), 'Tomorrow');
    // The spec's example: Friday seen from earlier in the week.
    assert.equal(
      formatDayET(fromLocal('2026-11-20', 7 * 60), fromLocal('2026-11-18', 9 * 60)),
      'Fri, Nov 20',
    );
    assert.equal(formatDayET(fromLocal('2026-11-21', 8 * 60), noon), 'Sat, Nov 21');
    assert.equal(formatDayET(fromLocal('2026-11-18', 8 * 60), noon), 'Wed, Nov 18');
    assert.equal(formatDayET(fromLocal('2026-12-05', 8 * 60), noon), 'Sat, Dec 5');
    assert.equal(formatDayET(fromLocal('2027-01-01', 8 * 60), noon), 'Fri, Jan 1');
  });

  it('decides today and tomorrow on the Toronto calendar, not the UTC one', () => {
    // 19:10 on Thursday is 00:10 UTC on Friday.
    assert.equal(formatDayET(utc(2026, 11, 20, 0, 10), noon), 'Today');
    assert.equal(formatDayET(noon, utc(2026, 11, 20, 0, 10)), 'Today');
    assert.equal(formatDayET(utc(2026, 11, 20, 4, 59), noon), 'Today');
    assert.equal(formatDayET(utc(2026, 11, 20, 5, 0), noon), 'Tomorrow');
    assert.equal(formatDayET(fromLocal('2027-01-01', 600), fromLocal('2026-12-31', 600)), 'Tomorrow');
    // Across the spring switch the next calendar day is 23 hours away.
    assert.equal(formatDayET(fromLocal('2026-03-08', 210), fromLocal('2026-03-07', 1410)), 'Tomorrow');
    assert.equal(formatDayET(fromLocal('2026-03-09', 420), fromLocal('2026-03-07', 1410)), 'Mon, Mar 9');
    // On the 25-hour day both 01:30s are the same day.
    assert.equal(formatDayET(utc(2026, 11, 1, 6, 30), utc(2026, 11, 1, 5, 30)), 'Today');
  });

  it('names every month and weekday in English', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const seenFrom = fromLocal('2025-06-15', 0);
    months.forEach((month, index) => {
      const date = `2026-${String(index + 1).padStart(2, '0')}-15`;
      const expected = `${WEEKDAY_SHORT_NAMES[weekdayOf(date)]}, ${month} 15`;
      assert.equal(formatDayET(fromLocal(date, 720), seenFrom), expected);
    });
    // 2026-11-16 is a Monday.
    const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    week.forEach((name, index) => {
      assert.equal(
        formatDayET(fromLocal(addLocalDays('2026-11-16', index), 720), seenFrom),
        `${name}, Nov ${16 + index}`,
      );
    });
    assert.deepEqual(WEEKDAY_SHORT_NAMES, {
      mon: 'Mon',
      tue: 'Tue',
      wed: 'Wed',
      thu: 'Thu',
      fri: 'Fri',
      sat: 'Sat',
      sun: 'Sun',
    });
    assert.deepEqual(WEEKDAY_NAMES, {
      mon: 'Monday',
      tue: 'Tuesday',
      wed: 'Wednesday',
      thu: 'Thursday',
      fri: 'Friday',
      sat: 'Saturday',
      sun: 'Sunday',
    });
  });

  it('formats a window like "7–9 am" and "11 am–1 pm"', () => {
    assert.equal(formatWindowET(thursday(7), thursday(9)), '7–9 am');
    assert.equal(formatWindowET(thursday(9), thursday(11)), '9–11 am');
    assert.equal(formatWindowET(thursday(11), thursday(13)), '11 am–1 pm');
    assert.equal(formatWindowET(thursday(13), thursday(15)), '1–3 pm');
    assert.equal(formatWindowET(thursday(15), thursday(17)), '3–5 pm');
    assert.equal(formatWindowET(thursday(17), thursday(19)), '5–7 pm');
    // Weekend slots.
    assert.equal(formatWindowET(thursday(8), thursday(10)), '8–10 am');
    assert.equal(formatWindowET(thursday(10), thursday(12)), '10 am–12 pm');
    assert.equal(formatWindowET(thursday(12), thursday(14)), '12–2 pm');
    assert.equal(formatWindowET(thursday(14), thursday(16)), '2–4 pm');
    // Minutes appear only when there are some.
    assert.equal(formatWindowET(thursday(7, 30), thursday(9, 30)), '7:30–9:30 am');
    assert.equal(formatWindowET(thursday(11, 45), thursday(13)), '11:45 am–1 pm');
  });

  it('formats day and time together', () => {
    const friday = fromLocal('2026-11-20', 13 * 60 + 40);
    assert.equal(formatDateTimeET(friday), 'Fri, Nov 20, 1:40 pm');
    assert.equal(formatDateTimeET(friday, null), 'Fri, Nov 20, 1:40 pm');
    assert.equal(formatDateTimeET(friday, friday - HOUR), 'Today, 1:40 pm');
    assert.equal(
      formatDateTimeET(fromLocal('2026-11-20', 7 * 60 + 15), thursday(16, 50)),
      'Tomorrow, 7:15 am',
    );
    assert.equal(
      formatDateTimeET(fromLocal('2026-11-21', 14 * 60), thursday(16, 50)),
      'Sat, Nov 21, 2:00 pm',
    );
    // A receipt spells the date out even on the day itself.
    assert.equal(formatDateTimeET(thursday(12, 25)), 'Thu, Nov 19, 12:25 pm');
    // So does a screen whose clock is not usable: better a date than a wrong "Today".
    assert.equal(formatDateTimeET(thursday(12, 25), Number.NaN), 'Thu, Nov 19, 12:25 pm');
    assert.equal(formatDayET(thursday(12, 25), Number.NaN), 'Thu, Nov 19');
  });

  it('converts numbers and dates to milliseconds', () => {
    assert.equal(toMillis(1795108800000), 1795108800000);
    assert.equal(toMillis(new Date(1795108800000)), 1795108800000);
    assert.equal(toMillis(0), 0);
    assert.equal(toMillis(null), null);
    assert.equal(toMillis(undefined), null);
    assert.equal(toMillis(Number.NaN), null);
    assert.equal(toMillis(new Date(Number.NaN)), null);
  });

  it('answers null, not a crash, for text or an old `{ toMillis() }` timestamp', () => {
    const legacy = { toMillis: () => 1795108800000 } as unknown as Date;
    assert.equal(toMillis(legacy), null);
    assert.equal(toMillis('2026-11-19' as unknown as number), null);
    assert.equal(formatClockET(legacy), '—');
  });
});

describe('independence from the device', () => {
  it('gives the same answers whatever time zone the process runs in', () => {
    const before = process.env.TZ;
    const instant = utc(2026, 11, 19, 17, 25);
    try {
      for (const zone of [
        'Asia/Kolkata',
        'Pacific/Auckland',
        'America/Los_Angeles',
        'America/Toronto',
        'UTC',
      ]) {
        process.env.TZ = zone;
        assert.deepEqual(toLocal(instant), { date: '2026-11-19', weekday: 'thu', minutes: 745 }, zone);
        assert.equal(fromLocal('2026-11-19', 745), instant, zone);
        assert.equal(fromLocal('2026-03-08', 150), utc(2026, 3, 8, 7, 30), zone);
        assert.equal(startOfLocalDay('2026-07-01'), utc(2026, 7, 1, 4), zone);
        assert.equal(formatDateTimeET(instant), 'Thu, Nov 19, 12:25 pm', zone);
        assert.equal(formatDayET(utc(2026, 11, 20, 0, 10), instant), 'Today', zone);
        assert.equal(formatWindowET(instant - 85 * MINUTE, instant + 35 * MINUTE), '11 am–1 pm', zone);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('uses no Intl, no device clock and no device-zone getter in the time sources (D14)', () => {
    for (const file of ['time-zone.ts', 'fulfilment-time.ts']) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      // Comments may name what is forbidden; only code counts.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const forbidden = [
        /\bIntl\b/,
        /toLocale\w*String/,
        /Date\.now\s*\(/,
        /new Date\(\s*\)/,
        /\.get(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\(/,
        /\.set(FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\(/,
        /Math\.random/,
      ];
      for (const pattern of forbidden) assert.ok(!pattern.test(code), `${file} uses ${pattern}`);
    }
  });

  it('is exported from the package root under the same names', async () => {
    const root: Record<string, unknown> = await import('../src');
    const names = Object.keys(timeZone).filter((name) => name !== 'default');
    assert.ok(names.includes('torontoOffsetMinutes') && names.includes('formatDateTimeET'));
    for (const name of names) {
      assert.equal(root[name], (timeZone as Record<string, unknown>)[name], name);
    }
  });
});
