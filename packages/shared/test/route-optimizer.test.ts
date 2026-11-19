import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { roadTenths } from '../src/geo';
import { decodePolyline, encodePolyline, simplifyPath } from '../src/polyline';
import {
  buildEstimateMatrix,
  fillMatrixGaps,
  optimizeStops,
  type OptimizedRoute,
  type OptimizerStop,
  type TravelMatrix,
} from '../src/route-optimizer';
import type { LatLng } from '../src/types';

const origin = { lat: 12.9716, lng: 77.5946 };

/** Points on a line heading east, ~1.1 km apart. */
const lineStops = (count: number): OptimizerStop[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `stop-${index + 1}`,
    location: { lat: origin.lat, lng: origin.lng + 0.01 * (index + 1) },
  }));

/**
 * These cases were written for a 24 km/h matrix, and the tight-window case depends on it. The speed is
 * pinned here so they keep testing the optimizer and not the value of DEFAULT_CITY_SPEED_KMH, which is
 * now the GTA figure of 36 (§12.1).
 */
const CASE_SPEED_KMH = 24;

const matrixFor = (stops: OptimizerStop[]): TravelMatrix =>
  buildEstimateMatrix([origin, ...stops.map((stop) => stop.location)], CASE_SPEED_KMH);

describe('optimizeStops', () => {
  it('returns an empty route when there are no stops', () => {
    const result = optimizeStops([], buildEstimateMatrix([origin]));
    assert.deepEqual(result.legs, []);
    assert.equal(result.totalSeconds, 0);
  });

  it('visits collinear stops in order regardless of input order', () => {
    const stops = lineStops(6);
    const shuffled = [stops[3]!, stops[0]!, stops[5]!, stops[1]!, stops[4]!, stops[2]!];
    const result = optimizeStops(shuffled, matrixFor(shuffled), { startTime: 0 });
    assert.deepEqual(
      result.legs.map((leg) => leg.id),
      ['stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5', 'stop-6'],
    );
  });

  it('improves on a greedy trap with 2-opt', () => {
    // Greedy would go to the close stop on the right first, then cross back west.
    const stops: OptimizerStop[] = [
      { id: 'east-near', location: { lat: origin.lat, lng: origin.lng + 0.004 } },
      { id: 'west-1', location: { lat: origin.lat, lng: origin.lng - 0.005 } },
      { id: 'west-2', location: { lat: origin.lat, lng: origin.lng - 0.03 } },
      { id: 'west-3', location: { lat: origin.lat, lng: origin.lng - 0.06 } },
    ];
    const matrix = matrixFor(stops);
    const result = optimizeStops(stops, matrix, { startTime: 0 });
    // The optimal open path heads east first and then sweeps west.
    assert.deepEqual(
      result.legs.map((leg) => leg.id),
      ['east-near', 'west-1', 'west-2', 'west-3'],
    );
    const legSum = result.legs.reduce((sum, leg) => sum + leg.legSeconds, 0);
    assert.ok(Math.abs(legSum - result.totalSeconds) < 1e-6);
  });

  it('keeps the locked stop first', () => {
    const stops = lineStops(5);
    const result = optimizeStops(stops, matrixFor(stops), { lockedFirstId: 'stop-5', startTime: 0 });
    assert.equal(result.legs[0]!.id, 'stop-5');
    assert.equal(result.legs.length, 5);
  });

  it('moves urgent stops earlier', () => {
    const stops = lineStops(6);
    stops[5] = { ...stops[5]!, priority: 'urgent' };
    const result = optimizeStops(stops, matrixFor(stops), { startTime: 0 });
    const urgentPosition = result.legs.findIndex((leg) => leg.id === 'stop-6');
    assert.ok(urgentPosition < 5, `urgent stop should not be last (was ${urgentPosition})`);
  });

  it('respects a tight time window', () => {
    const stops = lineStops(6);
    // stop-6 is ~22 min away; a 25-minute window is only achievable by going there first.
    stops[5] = { ...stops[5]!, windowEnd: 25 * 60 * 1000 };
    const result = optimizeStops(stops, matrixFor(stops), { startTime: 0 });
    const windowed = result.legs.find((leg) => leg.id === 'stop-6');
    assert.equal(windowed?.lateSeconds, 0);
    // Only stops directly on the way (stop-1) may come before it.
    const position = result.legs.findIndex((leg) => leg.id === 'stop-6');
    assert.ok(position <= 1, `windowed stop visited too late (position ${position})`);
  });

  it('computes cumulative arrival offsets including service time', () => {
    const stops = lineStops(3);
    const result = optimizeStops(stops, matrixFor(stops), { startTime: 0, defaultServiceSeconds: 120 });
    const [first, second] = result.legs;
    assert.ok(first && second);
    assert.ok(
      Math.abs(second.arrivalOffsetSeconds - (first.arrivalOffsetSeconds + 120 + second.legSeconds)) < 1e-6,
    );
  });

  it('rejects a matrix of the wrong size', () => {
    const stops = lineStops(3);
    assert.throws(() => optimizeStops(stops, buildEstimateMatrix([origin])));
  });
});

describe('fillMatrixGaps', () => {
  it('replaces invalid cells with estimates', () => {
    const points = [origin, { lat: origin.lat + 0.01, lng: origin.lng }];
    const filled = fillMatrixGaps(
      {
        seconds: [
          [0, Number.POSITIVE_INFINITY],
          [120, 0],
        ],
        meters: [
          [0, -1],
          [900, 0],
        ],
      },
      points,
    );
    assert.ok(Number.isFinite(filled.seconds[0]![1]!));
    assert.ok(filled.meters[0]![1]! > 0);
    assert.equal(filled.seconds[1]![0], 120);
  });
});

// ---------- pickup before drop-off (§5.11) ----------

/** A stop for a hand-written matrix. The optimizer reads travel from the matrix, never the location. */
const stopAt = (id: string, extra: Partial<OptimizerStop> = {}): OptimizerStop => ({
  id,
  location: origin,
  ...extra,
});

/** A matrix of whole travel seconds. Metres are 10 per second, so the two tables cannot be mixed up. */
const matrixOf = (seconds: number[][]): TravelMatrix => ({
  seconds,
  meters: seconds.map((row) => row.map((value) => value * 10)),
});

/** Points along one street; driving between two of them takes 100 s per unit. Point 0 is the driver. */
const streetMatrix = (positions: number[]): TravelMatrix =>
  matrixOf(positions.map((from) => positions.map((to) => Math.abs(from - to) * 100)));

const idsOf = (route: OptimizedRoute): string[] => route.legs.map((leg) => leg.id);

describe('optimizeStops: pickup before drop-off (§5.11)', () => {
  // Points: 0 the driver, 1 the jobsite, 2 the store. The jobsite is on the driver's doorstep.
  const nearSite = matrixOf([
    [0, 300, 900],
    [300, 0, 700],
    [900, 700, 0],
  ]);

  it('collects the load at the store first, even when the jobsite is nearer', () => {
    const pickup = stopAt('job-1:pickup', { serviceSeconds: 900 }); // 15 min of loading
    const dropoff = stopAt('job-1', { serviceSeconds: 180 });

    // Without the rule the jobsite comes first: 300 + 700 = 1 000 s of driving against 1 600.
    const free = optimizeStops([dropoff, pickup], nearSite, { startTime: 0 });
    assert.deepEqual(idsOf(free), ['job-1', 'job-1:pickup']);
    assert.equal(free.totalSeconds, 1000);

    const route = optimizeStops([{ ...dropoff, after: 'job-1:pickup' }, pickup], nearSite, { startTime: 0 });
    assert.deepEqual(route, {
      legs: [
        {
          id: 'job-1:pickup',
          stopIndex: 1,
          legSeconds: 900,
          legMeters: 9000,
          arrivalOffsetSeconds: 900,
          lateSeconds: 0,
        },
        // 900 to the store + 900 loading + 700 to the site.
        {
          id: 'job-1',
          stopIndex: 0,
          legSeconds: 700,
          legMeters: 7000,
          arrivalOffsetSeconds: 2500,
          lateSeconds: 0,
        },
      ],
      totalSeconds: 1600,
      totalMeters: 16000,
      finishOffsetSeconds: 2680,
      cost: 1600,
    });
  });

  it('waits until the store is ready and keeps the order even when delivering first would be on time', () => {
    const startTime = Date.UTC(2026, 10, 19, 17, 25); // Thu 2026-11-19, 12:25 in Toronto
    const stops: OptimizerStop[] = [
      // Deliver by 13:10.
      stopAt('job-1', { after: 'job-1:pickup', windowEnd: startTime + 45 * 60_000, serviceSeconds: 180 }),
      // Ready by 12:45 (`pickup.readyBy`), 15 min of loading.
      stopAt('job-1:pickup', { windowStart: startTime + 20 * 60_000, serviceSeconds: 900 }),
    ];
    const route = optimizeStops(stops, nearSite, { startTime });
    assert.deepEqual(route, {
      legs: [
        // At the store at 12:40, 5 min early: the arrival that counts is 12:45.
        {
          id: 'job-1:pickup',
          stopIndex: 1,
          legSeconds: 900,
          legMeters: 9000,
          arrivalOffsetSeconds: 1200,
          lateSeconds: 0,
        },
        // Loaded at 13:00, at the site at 13:11:40: 100 s after the window.
        {
          id: 'job-1',
          stopIndex: 0,
          legSeconds: 700,
          legMeters: 7000,
          arrivalOffsetSeconds: 2800,
          lateSeconds: 100,
        },
      ],
      totalSeconds: 1600,
      totalMeters: 16000,
      finishOffsetSeconds: 2980,
      // 1 600 s of driving + 100 s late × 5. Site first would cost 1 000 and be on time, but the load
      // would not be on the truck.
      cost: 2100,
    });
  });

  it('lets two jobs share the trip: both pickups, then both drop-offs', () => {
    // Driver at 0, stores at 1 and 2, jobsites at 10 and 11.
    const stops = [
      stopAt('job-b', { after: 'job-b:pickup' }),
      stopAt('job-a', { after: 'job-a:pickup' }),
      stopAt('job-b:pickup'),
      stopAt('job-a:pickup'),
    ];
    const route = optimizeStops(stops, streetMatrix([0, 11, 10, 2, 1]), { startTime: 0 });
    assert.deepEqual(idsOf(route), ['job-a:pickup', 'job-b:pickup', 'job-a', 'job-b']);
    assert.equal(route.totalSeconds, 1100);
  });

  describe('a move that would break the order', () => {
    // Driver at 0. A manual delivery 1 east, a store 1 west and its jobsite 2 west, a manual delivery 6 east.
    const street = streetMatrix([0, 1, -1, -2, 6]);
    const stops = [
      stopAt('manual-1'),
      stopAt('job-1:pickup'),
      stopAt('job-1', { after: 'job-1:pickup' }),
      stopAt('manual-2'),
    ];

    it('is not in the first tour: nearest neighbour already has the pickup first', () => {
      const tour = optimizeStops(stops, street, { startTime: 0, searchBudget: 0 });
      assert.deepEqual(idsOf(tour), ['manual-1', 'job-1:pickup', 'job-1', 'manual-2']);
      assert.equal(tour.totalSeconds, 1200);
    });

    it('is rejected, and the legal relocation with the same saving is taken', () => {
      // Reversing the first three stops gives job-1, job-1:pickup, manual-1, manual-2: 1 000 s, but the
      // drop-off would come first. Moving manual-1 behind the job saves the same 200 s legally.
      const route = optimizeStops(stops, street, { startTime: 0 });
      assert.deepEqual(idsOf(route), ['job-1:pickup', 'job-1', 'manual-1', 'manual-2']);
      assert.equal(route.totalSeconds, 1000);
      assert.equal(route.cost, 1000);
    });

    it('is exactly what the search does when the rule is absent', () => {
      const free = stops.map((stop) => stopAt(stop.id));
      const route = optimizeStops(free, street, { startTime: 0 });
      assert.deepEqual(idsOf(route), ['job-1', 'job-1:pickup', 'manual-1', 'manual-2']);
      assert.equal(route.totalSeconds, 1000);
    });
  });

  it('keeps a chain: c after b, b after a', () => {
    // Driver at 0; c, b and a at 1, 2 and 3. Left alone the route would be c, b, a (300 s).
    const stops = [stopAt('c', { after: 'b' }), stopAt('b', { after: 'a' }), stopAt('a')];
    const street = streetMatrix([0, 1, 2, 3]);
    const free = stops.map((stop) => stopAt(stop.id));
    assert.deepEqual(idsOf(optimizeStops(free, street)), ['c', 'b', 'a']);
    const route = optimizeStops(stops, street);
    assert.deepEqual(idsOf(route), ['a', 'b', 'c']);
    assert.equal(route.totalSeconds, 500);
  });

  it('lets one pickup come before several drop-offs', () => {
    // Driver at 0, jobsites at 1 and 2, the store at 5.
    const stops = [
      stopAt('site-1', { after: 'store' }),
      stopAt('site-2', { after: 'store' }),
      stopAt('store'),
    ];
    const route = optimizeStops(stops, streetMatrix([0, 1, 2, 5]));
    assert.deepEqual(idsOf(route), ['store', 'site-2', 'site-1']);
    assert.equal(route.totalSeconds, 900);
  });

  it('ignores an `after` that names no stop of the route: that stop is already done', () => {
    const plain = lineStops(4);
    const collected = plain.map((stop) =>
      stop.id === 'stop-1' ? { ...stop, after: 'stop-1:pickup' } : stop,
    );
    const expected = optimizeStops(plain, matrixFor(plain), { startTime: 0 });
    assert.deepEqual(optimizeStops(collected, matrixFor(collected), { startTime: 0 }), expected);
    assert.deepEqual(idsOf(expected), ['stop-1', 'stop-2', 'stop-3', 'stop-4']);
  });

  it('reads a repeated id as the first stop that has it, as `lockedFirstId` does', () => {
    // Driver at 0. Two stops share the id "x", at 5 and at 2; "y" at 1 has to follow "x". It follows the
    // first one (at 5), so it cannot slip in right after the nearer second one.
    const stops = [stopAt('x'), stopAt('x'), stopAt('y', { after: 'x' })];
    const route = optimizeStops(stops, streetMatrix([0, 5, 2, 1]));
    assert.deepEqual(
      route.legs.map((leg) => leg.stopIndex),
      [1, 0, 2],
    );
    assert.equal(route.totalSeconds, 900);
  });

  it('keeps the locked stop first and still collects before dropping', () => {
    // Driver at 0, a jobsite at 2 and its store at 1, and the manual stop being driven to at 9.
    const stops = [stopAt('job-1', { after: 'job-1:pickup' }), stopAt('job-1:pickup'), stopAt('manual-1')];
    const street = streetMatrix([0, 2, 1, 9]);
    const free = optimizeStops(stops, street, { startTime: 0 });
    assert.deepEqual(idsOf(free), ['job-1:pickup', 'job-1', 'manual-1']);
    assert.equal(free.totalSeconds, 900);

    const locked = optimizeStops(stops, street, { startTime: 0, lockedFirstId: 'manual-1' });
    assert.deepEqual(idsOf(locked), ['manual-1', 'job-1:pickup', 'job-1']);
    assert.equal(locked.totalSeconds, 1800);
  });

  it('keeps a locked pickup first with its drop-off after it', () => {
    // Driver at 0, the jobsite at 4, a manual stop at 1, the store at 8.
    const stops = [stopAt('job-1', { after: 'job-1:pickup' }), stopAt('manual-1'), stopAt('job-1:pickup')];
    const route = optimizeStops(stops, streetMatrix([0, 4, 1, 8]), {
      startTime: 0,
      lockedFirstId: 'job-1:pickup',
    });
    assert.deepEqual(idsOf(route), ['job-1:pickup', 'job-1', 'manual-1']);
    assert.equal(route.totalSeconds, 1500);
  });

  it('lets the lock win over the `after` of the locked stop itself, and keeps every other order', () => {
    // The driver is already heading to the job-1 site although its pickup is still listed. The plan
    // cannot undo that, so job-1 stays first; job-2 is still collected before it is dropped.
    const stops = [
      stopAt('job-1', { after: 'job-1:pickup' }),
      stopAt('job-1:pickup'),
      stopAt('job-2', { after: 'job-2:pickup' }),
      stopAt('job-2:pickup'),
    ];
    const route = optimizeStops(stops, streetMatrix([0, 1, 2, 3, 4]), {
      startTime: 0,
      lockedFirstId: 'job-1',
    });
    assert.deepEqual(idsOf(route), ['job-1', 'job-1:pickup', 'job-2:pickup', 'job-2']);
    assert.equal(route.totalSeconds, 500);
  });

  it('refuses stops that would have to come before themselves', () => {
    const street = streetMatrix([0, 1, 2, 3]);
    const loops: OptimizerStop[][] = [
      [stopAt('a', { after: 'a' }), stopAt('b'), stopAt('c')],
      [stopAt('a', { after: 'b' }), stopAt('b', { after: 'a' }), stopAt('c')],
      [stopAt('a', { after: 'c' }), stopAt('b', { after: 'a' }), stopAt('c', { after: 'b' })],
      // A stop that merely follows a loop does not hide it.
      [stopAt('a', { after: 'b' }), stopAt('b', { after: 'c' }), stopAt('c', { after: 'b' })],
    ];
    for (const stops of loops) {
      assert.throws(() => optimizeStops(stops, street, { startTime: 0 }), RangeError, JSON.stringify(stops));
    }
    assert.throws(
      () => optimizeStops([stopAt('a', { after: 'a' }), stopAt('b'), stopAt('c')], street, { startTime: 0 }),
      /stop "a" would have to come before itself/,
    );
  });
});

// ---------- precedence on random instances (§13.1) ----------

/** mulberry32: a small seeded generator, so every run builds the same "random" instances. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** The draws the instance builders share, all from one seeded source. */
function seeded(seed: number) {
  const random = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const chance = (probability: number) => random() < probability;
  /** Fisher–Yates, in place: the caller's order of stops must not matter for the rule. */
  const shuffle = <T>(items: T[]): void => {
    for (let last = items.length - 1; last > 0; last -= 1) {
      const other = int(0, last);
      const moved = items[last];
      const swapped = items[other];
      if (moved !== undefined && swapped !== undefined) {
        items[last] = swapped;
        items[other] = moved;
      }
    }
  };
  return { int, chance, shuffle, random };
}

interface Instance {
  stops: OptimizerStop[];
  matrix: TravelMatrix;
  startTime: number;
  lockedFirstId: string | null;
}

const PRIORITY_WEIGHT = { normal: 1, high: 2, urgent: 4 } as const;
const PRIORITY_NAMES = ['normal', 'high', 'urgent'] as const;
const DEFAULT_SERVICE = 180;
/** Pinned, so the seeded days below do not move when the default speed of the estimates does. */
const GTA_SPEED_KMH = 36;

/**
 * A driver's day in the GTA: 1 to 4 marketplace jobs (a pickup, then one or sometimes two drop-offs),
 * up to 3 single stops, in a shuffled order, with ready times, delivery windows, priorities and, four
 * times in ten, a stop the driver is already heading to. All travel times are whole seconds, so every
 * cost below is exact.
 */
function driverDay(seed: number): Instance {
  const { int, chance, shuffle, random } = seeded(seed);
  const point = (): LatLng => ({ lat: 43.6 + random() * 0.3, lng: -79.7 + random() * 0.5 });
  const priority = () => (chance(0.3) ? (PRIORITY_NAMES[int(0, 2)] ?? 'normal') : 'normal');
  const startTime = Date.UTC(2026, 10, 19, 17, 25) + int(0, 3600) * 1000;

  const stops: OptimizerStop[] = [];
  const jobs = int(1, 4);
  for (let job = 1; job <= jobs; job += 1) {
    const jobPriority = priority();
    stops.push({
      id: `job-${job}:pickup`,
      location: point(),
      priority: jobPriority,
      windowStart: chance(0.7) ? startTime + int(-600, 3600) * 1000 : null,
      serviceSeconds: int(1, 4) * 300,
    });
    const dropoffs = chance(0.15) ? 2 : 1;
    for (let dropoff = 1; dropoff <= dropoffs; dropoff += 1) {
      stops.push({
        id: dropoffs === 1 ? `job-${job}` : `job-${job}/${dropoff}`,
        location: point(),
        priority: jobPriority,
        windowEnd: chance(0.7) ? startTime + int(1800, 10800) * 1000 : null,
        after: `job-${job}:pickup`,
      });
    }
  }
  const singles = int(0, 3);
  for (let single = 1; single <= singles; single += 1) {
    stops.push({
      id: `single-${single}`,
      location: point(),
      priority: priority(),
      windowEnd: chance(0.4) ? startTime + int(900, 10800) * 1000 : null,
      // A collected delivery may still name its pickup, which is no longer on the route.
      after: chance(0.3) ? `single-${single}:pickup` : undefined,
    });
  }
  shuffle(stops);

  const size = stops.length + 1;
  const seconds = chance(0.5)
    ? // Straight-line estimates, rounded to whole seconds.
      buildEstimateMatrix([point(), ...stops.map((stop) => stop.location)], GTA_SPEED_KMH).seconds.map(
        (row) => row.map((value) => Math.round(value)),
      )
    : // Different times in each direction, like a traffic-aware provider's answer.
      Array.from({ length: size }, (_, from) =>
        Array.from({ length: size }, (_, to) => (from === to ? 0 : int(60, 3600))),
      );

  const lockedFirstId = chance(0.4) ? (stops[int(0, stops.length - 1)]?.id ?? null) : null;
  return { stops, matrix: matrixOf(seconds), startTime, lockedFirstId };
}

/**
 * Stops tied to each other in every way that still has an answer: stop k may name any stop made before
 * it, so chains and shared predecessors are common. Then the list is shuffled.
 */
function tangledDay(seed: number): Instance {
  const { int, chance, shuffle } = seeded(seed);
  const count = int(2, 10);
  const stops: OptimizerStop[] = [];
  for (let index = 0; index < count; index += 1) {
    stops.push({
      id: `stop-${index}`,
      location: origin,
      priority: chance(0.5) ? (PRIORITY_NAMES[int(0, 2)] ?? 'normal') : 'normal',
      after: index > 0 && chance(0.6) ? `stop-${int(0, index - 1)}` : undefined,
    });
  }
  shuffle(stops);
  const size = count + 1;
  const seconds = Array.from({ length: size }, (_, from) =>
    Array.from({ length: size }, (_, to) => (from === to ? 0 : int(30, 1800))),
  );
  const lockedFirstId = chance(0.3) ? (stops[int(0, count - 1)]?.id ?? null) : null;
  return { stops, matrix: matrixOf(seconds), startTime: 0, lockedFirstId };
}

/** The same day with every `after` taken off: what the optimizer was given before the marketplace. */
const withoutRule = (instance: Instance): Instance => ({
  ...instance,
  stops: instance.stops.map((stop) => ({ ...stop, after: undefined })),
});

/** The cost formula of the module header, written out again so the test does not trust the code it checks. */
function priceOf(order: readonly number[], { stops, matrix, startTime }: Instance): number {
  let clock = 0;
  let travel = 0;
  let penalty = 0;
  let previous = 0;
  for (const stopIndex of order) {
    const stop = stops[stopIndex];
    const leg = matrix.seconds[previous]?.[stopIndex + 1];
    assert.ok(stop !== undefined && leg !== undefined, `stop ${stopIndex} is not on the route`);
    clock += leg;
    travel += leg;
    if (stop.windowStart != null) clock = Math.max(clock, (stop.windowStart - startTime) / 1000);
    penalty += (PRIORITY_WEIGHT[stop.priority ?? 'normal'] - 1) * clock * 0.5;
    if (stop.windowEnd != null) penalty += Math.max(0, clock - (stop.windowEnd - startTime) / 1000) * 5;
    clock += stop.serviceSeconds ?? DEFAULT_SERVICE;
    previous = stopIndex + 1;
  }
  return travel + penalty;
}

/** The first broken rule of a route, as a sentence, or null when the route is valid. */
function brokenRule(order: readonly number[], { stops, lockedFirstId }: Instance): string | null {
  if ([...order].sort((a, b) => a - b).join() !== stops.map((_, index) => index).join()) {
    return `not every stop exactly once: ${order.join()}`;
  }
  const lockedIndex = lockedFirstId === null ? -1 : stops.findIndex((stop) => stop.id === lockedFirstId);
  if (lockedIndex >= 0 && order[0] !== lockedIndex) return `locked stop ${lockedFirstId} is not first`;
  for (const [position, stopIndex] of order.entries()) {
    const stop = stops[stopIndex];
    // The locked stop is first whatever it names (see `OptimizeOptions.lockedFirstId`).
    if (stop?.after === undefined || stopIndex === lockedIndex) continue;
    const earlierIndex = stops.findIndex((candidate) => candidate.id === stop.after);
    if (earlierIndex >= 0 && order.indexOf(earlierIndex) > position)
      return `${stop.id} comes before ${stop.after}`;
  }
  return null;
}

/** Every route one 2-opt reversal or one relocation away, leaving a locked first stop alone. */
function movesFrom(order: readonly number[], lockStart: number): number[][] {
  const moves: number[][] = [];
  for (let i = lockStart; i < order.length - 1; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      moves.push([...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]);
    }
  }
  for (let i = lockStart; i < order.length; i += 1) {
    for (let j = lockStart; j < order.length; j += 1) {
      if (i === j) continue;
      const moved = order.slice();
      const taken = moved.splice(i, 1);
      moved.splice(j, 0, ...taken);
      moves.push(moved);
    }
  }
  return moves;
}

const orderOf = (route: OptimizedRoute): number[] => route.legs.map((leg) => leg.stopIndex);

const solve = (
  { stops, matrix, startTime, lockedFirstId }: Instance,
  searchBudget?: number,
): OptimizedRoute => optimizeStops(stops, matrix, { startTime, lockedFirstId, searchBudget });

const BUDGETS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];

/** Runs one instance to the end and with every budget above, checking the rules each time. */
function checkInstance(instance: Instance, label: string): void {
  // Wherever the search is cut off, each stop is behind the one it names and the locked stop is first.
  let previousCost = Number.POSITIVE_INFINITY;
  for (const budget of BUDGETS) {
    const partial = solve(instance, budget);
    assert.equal(brokenRule(orderOf(partial), instance), null, `${label}, budget ${budget}`);
    assert.equal(partial.cost, priceOf(orderOf(partial), instance), `${label}, budget ${budget}: cost`);
    assert.ok(partial.cost <= previousCost, `${label}, budget ${budget}: more search made the route dearer`);
    previousCost = partial.cost;
  }

  const route = solve(instance, Number.POSITIVE_INFINITY);
  const order = orderOf(route);
  assert.equal(brokenRule(order, instance), null, label);
  assert.equal(route.cost, priceOf(order, instance), `${label}: cost`);
  assert.ok(route.cost <= previousCost, `${label}: the finished search is dearer than a cut-off one`);
  assert.deepEqual(
    idsOf(route),
    order.map((stopIndex) => instance.stops[stopIndex]?.id),
    `${label}: ids`,
  );

  // The search ran to the end: no legal move is left that makes the route cheaper. So the rule only
  // removes the moves that break it; it does not freeze the search.
  const lockStart = instance.stops.some((stop) => stop.id === instance.lockedFirstId) ? 1 : 0;
  for (const move of movesFrom(order, lockStart)) {
    if (brokenRule(move, instance) !== null) continue;
    assert.ok(priceOf(move, instance) >= route.cost - 1e-6, `${label}: ${move.join()} is legal and cheaper`);
  }

  // The default budget is far above what a day of this size needs.
  assert.deepEqual(solve(instance), route, `${label}: default budget`);
}

describe('optimizeStops: precedence on random instances', () => {
  it('puts every pickup before its drop-off on 400 seeded driver days, after 2-opt and relocate', () => {
    let dropoffs = 0;
    let locked = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const instance = driverDay(seed);
      dropoffs += instance.stops.filter((stop) => stop.after?.startsWith('job-')).length;
      locked += instance.lockedFirstId === null ? 0 : 1;
      checkInstance(instance, `driver day ${seed}`);
    }
    // What the seeds produce: the days really carry the rule and the lock.
    assert.deepEqual({ dropoffs, locked }, { dropoffs: 1191, locked: 149 });
  });

  it('keeps chains and shared predecessors on 300 seeded tangled days', () => {
    let tied = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const instance = tangledDay(seed);
      tied += instance.stops.filter((stop) => stop.after !== undefined).length;
      checkInstance(instance, `tangled day ${seed}`);
    }
    assert.equal(tied, 877);
  });

  it('holds after every single candidate the search tries', () => {
    // 25 days, cut off after 0, 1, 2, … candidates until the route is the finished one.
    for (let seed = 1; seed <= 25; seed += 1) {
      const instance = driverDay(seed);
      const finished = solve(instance, Number.POSITIVE_INFINITY);
      for (let budget = 0; ; budget += 1) {
        const partial = solve(instance, budget);
        assert.equal(brokenRule(orderOf(partial), instance), null, `driver day ${seed}, budget ${budget}`);
        if (partial.cost === finished.cost) break;
        assert.ok(budget < 100_000, `driver day ${seed} never settles`);
      }
    }
  });

  it('searches as it did before the marketplace when no stop names another', () => {
    // The same 400 days with `after` taken off. The three totals were computed with the optimizer as it
    // was before this rule existed, so they pin the old behaviour: nearest neighbour, 2-opt, relocate,
    // priorities, windows and the lock.
    let cost = 0;
    let seconds = 0;
    let digest = 0;
    let breaksRule = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const instance = driverDay(seed);
      const route = solve(withoutRule(instance));
      cost += route.cost;
      seconds += route.totalSeconds;
      for (const leg of route.legs) digest = (digest * 31 + leg.stopIndex + 1) % 1_000_000_007;
      if (brokenRule(orderOf(route), instance) !== null) breaksRule += 1;
    }
    assert.deepEqual(
      { cost, seconds, digest },
      { cost: 10_033_594, seconds: 3_868_419, digest: 885_805_962 },
    );
    // Left free, the search puts a drop-off ahead of its pickup on most of these days: the checks above
    // do not pass by luck.
    assert.equal(breaksRule, 339);
  });
});

// ---------- inputs and limits ----------

describe('optimizeStops: inputs and limits', () => {
  it('needs the route start as soon as a stop has a time window', () => {
    const stops = lineStops(3);
    const windowed = stops.map((stop) =>
      stop.id === 'stop-3' ? { ...stop, windowEnd: 25 * 60 * 1000 } : stop,
    );
    assert.throws(
      () => optimizeStops(windowed, matrixFor(windowed)),
      /options\.startTime \(epoch ms\) is required/,
    );
    assert.throws(() => optimizeStops(windowed, matrixFor(windowed), { startTime: Number.NaN }), RangeError);
    assert.deepEqual(idsOf(optimizeStops(windowed, matrixFor(windowed), { startTime: 0 })), [
      'stop-1',
      'stop-2',
      'stop-3',
    ]);
    // Without a window the start is never read, so it may be left out.
    assert.deepEqual(idsOf(optimizeStops(stops, matrixFor(stops))), ['stop-1', 'stop-2', 'stop-3']);
  });

  it('never reads the clock', (t) => {
    const instance = driverDay(7);
    const points = [origin, ...instance.stops.map((stop) => stop.location)];
    const expected = solve(instance);
    const estimate = buildEstimateMatrix(points);

    const clock = t.mock.method(Date, 'now', () => {
      throw new Error('the route optimizer read the clock');
    });
    try {
      assert.deepEqual(solve(instance), expected);
      // Not even when the start is left out: stops without a window do not need one.
      const plain = lineStops(3);
      assert.deepEqual(idsOf(optimizeStops(plain, matrixFor(plain))), ['stop-1', 'stop-2', 'stop-3']);
      assert.deepEqual(buildEstimateMatrix(points), estimate);
      assert.deepEqual(fillMatrixGaps(instance.matrix, points), instance.matrix);
    } finally {
      clock.mock.restore();
    }
  });

  it('bounds the search by a number of candidate routes', () => {
    // Driver at 0, stops at 1 and 3 east and 2 west. Nearest neighbour drives east-1, east-3, west-2
    // (800 s). The 8th candidate the search tries, moving west-2 to the front, is the first cheaper one.
    const stops = [stopAt('east-1'), stopAt('east-3'), stopAt('west-2')];
    const street = streetMatrix([0, 1, 3, -2]);
    const tour = optimizeStops(stops, street, { startTime: 0, searchBudget: 0 });
    assert.deepEqual(idsOf(tour), ['east-1', 'east-3', 'west-2']);
    assert.equal(tour.totalSeconds, 800);

    assert.deepEqual(optimizeStops(stops, street, { startTime: 0, searchBudget: 7 }), tour);
    const settled = optimizeStops(stops, street, { startTime: 0, searchBudget: 8 });
    assert.deepEqual(idsOf(settled), ['west-2', 'east-1', 'east-3']);
    assert.equal(settled.totalSeconds, 700);

    // No bound given, or one that is not a number: the default, far more than this needs.
    assert.deepEqual(optimizeStops(stops, street, { startTime: 0 }), settled);
    assert.deepEqual(optimizeStops(stops, street, { startTime: 0, searchBudget: Number.NaN }), settled);
    assert.deepEqual(
      optimizeStops(stops, street, { startTime: 0, searchBudget: Number.POSITIVE_INFINITY }),
      settled,
    );
    // A negative bound is no search at all.
    assert.deepEqual(optimizeStops(stops, street, { startTime: 0, searchBudget: -1 }), tour);
  });

  it('refuses a matrix with a short row or a travel time that is not a number of at least 0', () => {
    const stops = lineStops(3);
    const good = matrixFor(stops);
    const shortRow = good.seconds.map((row, from) => (from === 2 ? row.slice(0, 3) : row));
    assert.throws(
      () => optimizeStops(stops, { seconds: shortRow, meters: good.meters }),
      /Matrix must be 4x4/,
    );
    assert.throws(
      () => optimizeStops(stops, { seconds: good.seconds, meters: shortRow }),
      /Matrix must be 4x4/,
    );

    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const seconds = good.seconds.map((row, from) =>
        row.map((value, to) => (from === 0 && to === 2 ? broken : value)),
      );
      assert.throws(
        () => optimizeStops(stops, { seconds, meters: good.meters }),
        (error: unknown) =>
          error instanceof RangeError && /Matrix cell seconds\[0\]\[2\]/.test(error.message),
        String(broken),
      );
    }

    // The diagonal is never driven, so whatever a provider puts there is fine.
    const oddDiagonal = good.seconds.map((row, from) =>
      row.map((value, to) => (from === to ? Number.NaN : value)),
    );
    assert.deepEqual(
      optimizeStops(stops, { seconds: oddDiagonal, meters: good.meters }),
      optimizeStops(stops, good),
    );
  });

  it('does not change the stops, the matrix or the options it is given', () => {
    const freeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        for (const inner of Object.values(value)) freeze(inner);
        Object.freeze(value);
      }
      return value;
    };
    const instance = driverDay(11);
    const before = JSON.stringify(instance);
    const options = freeze({ startTime: instance.startTime, lockedFirstId: instance.lockedFirstId });
    const route = optimizeStops(freeze(instance.stops), freeze(instance.matrix), options);
    assert.equal(route.legs.length, instance.stops.length);
    assert.equal(JSON.stringify(instance), before);
  });
});

describe('buildEstimateMatrix', () => {
  // Kestrel Lumber Yard and the Leslieville jobsite (§11.2, §11.3).
  const kestrel = { lat: 43.6966, lng: -79.5752 };
  const leslieville = { lat: 43.6648, lng: -79.3405 };

  it('estimates the road distance the delivery fees use: Kestrel → Leslieville is 26.0 km', () => {
    const matrix = buildEstimateMatrix([kestrel, leslieville]);
    const meters = matrix.meters[0]?.[1];
    assert.ok(meters !== undefined);
    assert.equal(Math.ceil(meters / 100 - 1e-6), 260);
    assert.equal(roadTenths(kestrel, leslieville), 260);
    assert.equal(matrix.meters[1]?.[0], meters);
    assert.deepEqual([matrix.meters[0]?.[0], matrix.meters[1]?.[1], matrix.seconds[0]?.[0]], [0, 0, 0]);
  });

  it('drives at 36 km/h (10 m/s) unless a speed is given', () => {
    const meters = buildEstimateMatrix([kestrel, leslieville]).meters[0]?.[1];
    assert.ok(meters !== undefined);
    assert.equal(buildEstimateMatrix([kestrel, leslieville]).seconds[0]?.[1], meters / 10);
    // A flatbed at 30 km/h (§3.3).
    assert.equal(
      buildEstimateMatrix([kestrel, leslieville], 30).seconds[0]?.[1],
      meters / ((30 * 1000) / 3600),
    );
  });
});

// ---------- route geometry (polyline.ts) ----------

describe('polyline', () => {
  // The worked example of the encoded polyline format.
  const example: LatLng[] = [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ];
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  it('encodes and decodes the reference example', () => {
    assert.equal(encodePolyline(example), encoded);
    assert.deepEqual(decodePolyline(encoded), example);
  });

  it('round-trips GTA points at 5 decimals', () => {
    const path: LatLng[] = [
      { lat: 43.6966, lng: -79.5752 },
      { lat: 43.7709, lng: -79.4912 },
      { lat: 43.6648, lng: -79.3405 },
      { lat: 43.6648, lng: -79.3405 },
    ];
    assert.deepEqual(decodePolyline(encodePolyline(path)), path);
    assert.deepEqual(decodePolyline(''), []);
    assert.equal(encodePolyline([]), '');
  });

  it('refuses a string that stops in the middle of a number', () => {
    assert.throws(() => decodePolyline(encoded.slice(0, -1)), /Malformed polyline/);
  });

  it('thins a long path evenly and keeps both ends', () => {
    const path: LatLng[] = Array.from({ length: 101 }, (_, index) => ({ lat: 43 + index / 1000, lng: -79 }));
    const thinned = simplifyPath(path, 11);
    assert.deepEqual(
      thinned.map((point) => path.indexOf(point)),
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    );
    // A path that already fits comes back as a copy.
    const short = simplifyPath(path.slice(0, 5), 11);
    assert.deepEqual(short, path.slice(0, 5));
    assert.notEqual(short, path);
    // With room for one point only the start is left; with none, nothing.
    assert.deepEqual(simplifyPath(path, 1), [{ lat: 43, lng: -79 }]);
    assert.deepEqual(simplifyPath(path, 0), []);
  });
});
