/**
 * Multi-stop route optimizer.
 *
 * Builds an initial tour with a priority-aware nearest-neighbour heuristic, then improves it with
 * 2-opt (segment reversal) and relocate moves until no move lowers the cost or the search budget
 * runs out. The cost is total travel time plus penalties:
 *
 *   cost = Σ travel + Σ (priorityWeight − 1) · arrival · PRIORITY_FACTOR + Σ lateSeconds · LATE_FACTOR
 *
 * (PRIORITY_FACTOR = 0.5, LATE_FACTOR = 5.)
 *
 * With every stop at "normal" priority and no time windows, this is a shortest open path
 * (a travelling salesman path without returning to the depot). Asymmetric matrices, such as
 * traffic-aware travel times, are fully supported because each candidate is evaluated end to end.
 *
 * A stop can name another stop that has to come first (`after`): a marketplace load is collected at
 * the store before it is dropped at the jobsite (§5.11). The first tour and every later move keep
 * that order, so a route never shows a drop-off ahead of its pickup.
 *
 * Nothing here reads the clock. The route start is an argument and the search is bounded by a count
 * of candidate routes, not by elapsed time, so the same input gives the same route on a phone, in a
 * browser and on the server.
 */
import { DEFAULT_SERVICE_SECONDS, PRIORITY_META } from './constants';
import { DEFAULT_CITY_SPEED_KMH, estimateDriveSeconds, estimateRoadMeters, haversineMeters } from './geo';
import type { LatLng, Priority } from './types';

/**
 * Seconds of penalty per second an above-normal stop waits, per unit of extra priority weight.
 * With urgent (weight 4) every second of delay costs 1.5 s, so the optimizer will accept
 * a meaningful detour to serve urgent customers first.
 */
const PRIORITY_FACTOR = 0.5;
const LATE_FACTOR = 5;
const EPSILON = 1e-6;

/**
 * Candidate routes the local search may try unless the caller says otherwise. A driver's working
 * route (at most 4 marketplace jobs, so 8 stops, §5.5.3) settles within about 500, and routes of up to
 * about 40 stops still settle completely. The bound only cuts short longer manual routes, where it
 * keeps a plan within a fraction of a second on a server.
 */
const DEFAULT_SEARCH_BUDGET = 200_000;

export interface TravelMatrix {
  /** `seconds[i][j]` is the travel time from point `i` to point `j`. Index 0 is the origin. */
  seconds: number[][];
  meters: number[][];
}

export interface OptimizerStop {
  id: string;
  location: LatLng;
  priority?: Priority;
  /** Earliest useful arrival (epoch ms). The driver waits if early. */
  windowStart?: number | null;
  /** Latest acceptable arrival (epoch ms). Late arrivals are penalized. */
  windowEnd?: number | null;
  /** Time spent at the stop, in seconds. */
  serviceSeconds?: number;
  /**
   * The id of a stop that must come earlier in the route: a drop-off names its pickup, because the
   * load has to be collected at the store before it can be delivered (§5.11).
   *
   * An id that no stop of this route has is ignored: that stop is already done, so there is nothing
   * left to wait for. Two stops that would each have to come before the other are refused.
   */
  after?: string;
}

export interface OptimizeOptions {
  /**
   * Epoch ms when the route starts. Time windows are measured from it, so it is required as soon as a
   * stop has one. The caller reads the clock; shared code never does.
   */
  startTime: number;
  /**
   * Stop that must stay first, typically the one the driver is already heading to. It stays first
   * even when it names an `after` stop: the driver is on the way there, and a plan cannot undo that.
   */
  lockedFirstId?: string | null;
  defaultServiceSeconds?: number;
  /**
   * Upper bound on the candidate routes (2-opt reversals and relocations) the local search may try;
   * 200 000 by default. The search normally stops much sooner, when no move makes the route cheaper.
   * With 0 the result is the nearest-neighbour tour. Whatever the bound, the `after` order holds.
   */
  searchBudget?: number;
}

export interface PlannedLeg {
  id: string;
  /** Index into the `stops` array passed to `optimizeStops`. */
  stopIndex: number;
  legSeconds: number;
  legMeters: number;
  /** Seconds after the start when the driver arrives at this stop. */
  arrivalOffsetSeconds: number;
  /** Seconds after the window end, 0 when on time or without a window. */
  lateSeconds: number;
}

export interface OptimizedRoute {
  legs: PlannedLeg[];
  /** Sum of driving time across all legs. */
  totalSeconds: number;
  totalMeters: number;
  /** Seconds until the last stop is finished, including service and waiting time. */
  finishOffsetSeconds: number;
  cost: number;
}

/** Build a matrix from straight-line distances. Index 0 of `points` is the origin. */
export function buildEstimateMatrix(
  points: readonly LatLng[],
  speedKmh = DEFAULT_CITY_SPEED_KMH,
): TravelMatrix {
  const meters = points.map((from, i) =>
    points.map((to, j) => (i === j ? 0 : estimateRoadMeters(haversineMeters(from, to)))),
  );
  const seconds = meters.map((row) => row.map((road) => estimateDriveSeconds(road, speedKmh)));
  return { seconds, meters };
}

/**
 * Replace missing or invalid matrix cells (e.g. "route not found" from a provider) with estimates,
 * so the optimizer always gets a complete matrix.
 */
export function fillMatrixGaps(
  matrix: TravelMatrix,
  points: readonly LatLng[],
  speedKmh = DEFAULT_CITY_SPEED_KMH,
): TravelMatrix {
  const estimate = buildEstimateMatrix(points, speedKmh);
  const pick = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    seconds: estimate.seconds.map((row, i) =>
      row.map((fallback, j) => (i === j ? 0 : pick(matrix.seconds[i]?.[j], fallback))),
    ),
    meters: estimate.meters.map((row, i) =>
      row.map((fallback, j) => (i === j ? 0 : pick(matrix.meters[i]?.[j], fallback))),
    ),
  };
}

/** One stop as the search sees it: its place in the matrix and its limits as seconds after the start. */
interface Visit {
  id: string;
  /** Index into the caller's `stops`. */
  stopIndex: number;
  /** Row and column of this stop in the matrix: `stopIndex + 1`, because point 0 is the origin. */
  point: number;
  weight: number;
  /** Seconds after the route start; null when the stop has no such limit. */
  earliest: number | null;
  latest: number | null;
  service: number;
  /** `OptimizerStop.after` as given. */
  afterId: string | null;
  /** The visit that has to come earlier on the route: `afterId` resolved by `linkPrecedence`. */
  after: Visit | null;
}

/** Reads one cell of a travel table. */
type TableReader = (from: number, to: number) => number;

/**
 * Checks one table of the matrix and returns a reader for it. A table of the wrong shape, or with a
 * travel value that is not a finite number of at least 0, is refused here: further on it would become
 * NaN arrival times, or leave the first tour with no stop it can pick next. The diagonal is not
 * checked because a route never travels from a point to itself.
 */
function tableReader(
  name: 'seconds' | 'meters',
  table: readonly (readonly number[])[],
  size: number,
): TableReader {
  const shapeError = () => new Error(`Matrix must be ${size}x${size} (origin + ${size - 1} stops).`);
  if (!Array.isArray(table) || table.length !== size) throw shapeError();
  for (let from = 0; from < size; from += 1) {
    const row = table[from];
    if (!Array.isArray(row) || row.length !== size) throw shapeError();
    for (let to = 0; to < size; to += 1) {
      const value: unknown = row[to];
      if (from !== to && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        throw new RangeError(
          `Matrix cell ${name}[${from}][${to}] is not a finite number of at least 0: ${String(value)}. ` +
            'Complete a provider matrix with fillMatrixGaps first.',
        );
      }
    }
  }
  return (from, to) => {
    const value = table[from]?.[to];
    // Cannot happen: the shape was checked above and every index used below is a point of the matrix.
    if (value === undefined) throw new RangeError(`Matrix has no cell ${name}[${from}][${to}].`);
    return value;
  };
}

/**
 * Resolves every `after` id to the visit it names (§5.11). The first stop with an id wins, as for
 * `lockedFirstId`. Throws when the order cannot be met by any route.
 */
function linkPrecedence(visits: readonly Visit[], locked: Visit | null): void {
  const firstWithId = new Map<string, Visit>();
  for (const visit of visits) {
    if (!firstWithId.has(visit.id)) firstWithId.set(visit.id, visit);
  }
  for (const visit of visits) {
    // The locked stop is first whatever it names: the driver is already heading there.
    if (visit.afterId === null || visit === locked) continue;
    // An id that is not on this route names a stop that is already done: nothing to wait for.
    visit.after = firstWithId.get(visit.afterId) ?? null;
  }
  // A stop that would have to come before itself (directly, or through a chain of other stops) can
  // never be placed. Refuse it here instead of returning a route that breaks the order.
  for (const visit of visits) {
    let earlier = visit.after;
    for (let steps = 0; earlier !== null && steps < visits.length; steps += 1) {
      if (earlier === visit) {
        throw new RangeError(
          `optimizeStops: stop "${visit.id}" would have to come before itself. Check the "after" ids.`,
        );
      }
      earlier = earlier.after;
    }
  }
}

/** True when every visit comes later than the visit it has to follow. */
function keepsPrecedence(order: readonly Visit[], seen: Uint8Array): boolean {
  seen.fill(0);
  for (const visit of order) {
    if (visit.after !== null && seen[visit.after.point] !== 1) return false;
    seen[visit.point] = 1;
  }
  return true;
}

/**
 * Puts one driver's stops in the order to drive them. `matrix` holds the travel between the origin
 * (point 0) and every stop (stop `i` of `stops` is point `i + 1`).
 *
 * Throws for a matrix of the wrong shape or with a broken cell, for a stop with a time window when
 * `options.startTime` is missing, and for `after` ids that would put a stop before itself.
 */
export function optimizeStops(
  stops: readonly OptimizerStop[],
  matrix: TravelMatrix,
  options?: OptimizeOptions,
): OptimizedRoute {
  const size = stops.length + 1;
  const seconds = tableReader('seconds', matrix.seconds, size);
  const meters = tableReader('meters', matrix.meters, size);

  if (stops.length === 0) {
    return { legs: [], totalSeconds: 0, totalMeters: 0, finishOffsetSeconds: 0, cost: 0 };
  }

  // Windows are instants, the search works in seconds after the start. Without a start there is no
  // honest way to place a window, and reading the clock here would make the result depend on when
  // the function happens to run.
  const startTime = options?.startTime;
  const hasWindows = stops.some((stop) => stop.windowStart != null || stop.windowEnd != null);
  if (hasWindows && !(typeof startTime === 'number' && Number.isFinite(startTime))) {
    throw new RangeError(
      'optimizeStops: options.startTime (epoch ms) is required when a stop has a time window.',
    );
  }
  // Only stops with a window read the start, and those have a real one (checked above).
  const start = startTime ?? 0;
  const secondsAfterStart = (instant: number | null | undefined): number | null =>
    instant == null ? null : (instant - start) / 1000;

  const defaultService = options?.defaultServiceSeconds ?? DEFAULT_SERVICE_SECONDS;
  const visits: Visit[] = stops.map((stop, stopIndex) => ({
    id: stop.id,
    stopIndex,
    point: stopIndex + 1,
    weight: PRIORITY_META[stop.priority ?? 'normal'].weight,
    earliest: secondsAfterStart(stop.windowStart),
    latest: secondsAfterStart(stop.windowEnd),
    service: stop.serviceSeconds ?? defaultService,
    afterId: stop.after ?? null,
    after: null,
  }));

  const lockedId = options?.lockedFirstId;
  const locked = lockedId ? (visits.find((visit) => visit.id === lockedId) ?? null) : null;
  linkPrecedence(visits, locked);
  const hasPrecedence = visits.some((visit) => visit.after !== null);

  /** When the driver reaches `visit` after leaving the previous stop at `clock`: early arrivals wait. */
  const arrivalAt = (clock: number, legSeconds: number, visit: Visit): number => {
    const arrival = clock + legSeconds;
    return visit.earliest !== null && arrival < visit.earliest ? visit.earliest : arrival;
  };
  const latenessAt = (arrival: number, visit: Visit): number =>
    visit.latest !== null ? Math.max(0, arrival - visit.latest) : 0;

  const cost = (order: readonly Visit[]): number => {
    let clock = 0;
    let travel = 0;
    let penalty = 0;
    let previous = 0;
    for (const visit of order) {
      const legSeconds = seconds(previous, visit.point);
      const arrival = arrivalAt(clock, legSeconds, visit);
      travel += legSeconds;
      penalty += (visit.weight - 1) * arrival * PRIORITY_FACTOR;
      penalty += latenessAt(arrival, visit) * LATE_FACTOR;
      clock = arrival + visit.service;
      previous = visit.point;
    }
    return travel + penalty;
  };

  const seen = new Uint8Array(size);
  const isAllowed = hasPrecedence ? (order: readonly Visit[]) => keepsPrecedence(order, seen) : () => true;

  const requested = options?.searchBudget;
  const searchBudget =
    typeof requested === 'number' && !Number.isNaN(requested) ? requested : DEFAULT_SEARCH_BUDGET;

  const tour = nearestNeighbourTour(visits, seconds, locked);
  const order = improve(tour, locked ? 1 : 0, cost, isAllowed, searchBudget);

  const legs: PlannedLeg[] = [];
  let clock = 0;
  let totalSeconds = 0;
  let totalMeters = 0;
  let previous = 0;
  for (const visit of order) {
    const legSeconds = seconds(previous, visit.point);
    const legMeters = meters(previous, visit.point);
    const arrival = arrivalAt(clock, legSeconds, visit);
    legs.push({
      id: visit.id,
      stopIndex: visit.stopIndex,
      legSeconds,
      legMeters,
      arrivalOffsetSeconds: arrival,
      lateSeconds: latenessAt(arrival, visit),
    });
    totalSeconds += legSeconds;
    totalMeters += legMeters;
    clock = arrival + visit.service;
    previous = visit.point;
  }

  return { legs, totalSeconds, totalMeters, finishOffsetSeconds: clock, cost: cost(order) };
}

/**
 * The first tour: from each stop go to the nearest stop that may come next. A stop may come next once
 * the stop it has to follow is on the tour (§5.11), so a drop-off is never picked before its pickup.
 */
function nearestNeighbourTour(visits: readonly Visit[], seconds: TableReader, locked: Visit | null): Visit[] {
  const tour: Visit[] = [];
  const placed = new Set<Visit>();
  let from = 0;
  const place = (visit: Visit) => {
    tour.push(visit);
    placed.add(visit);
    from = visit.point;
  };
  if (locked) place(locked);

  while (tour.length < visits.length) {
    let next: Visit | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of visits) {
      if (placed.has(candidate)) continue;
      if (candidate.after !== null && !placed.has(candidate.after)) continue;
      // Higher-priority stops look "closer", so they tend to be visited earlier.
      const score = seconds(from, candidate.point) / candidate.weight;
      // Stops are tried in input order and only a clearly better one takes over, so equal scores
      // keep the stop that comes first in the caller's list.
      if (score < bestScore - EPSILON) {
        bestScore = score;
        next = candidate;
      }
    }
    // Cannot happen: `linkPrecedence` refused every loop, so among the stops still to place at least
    // one follows nothing that is missing, and its score is finite (the matrix was checked).
    if (next === null) throw new Error('optimizeStops: no stop can come next.');
    place(next);
  }
  return tour;
}

/**
 * Every route one move away, in the order the search tries them: all 2-opt reversals first, then all
 * relocations. Positions before `lockStart` never move.
 */
function* neighbours(order: readonly Visit[], lockStart: number): Generator<Visit[]> {
  const length = order.length;
  // 2-opt: reverse the segment order[i..j].
  for (let i = lockStart; i < length - 1; i += 1) {
    for (let j = i + 1; j < length; j += 1) {
      yield [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
    }
  }
  // Relocate: move a single stop to another position.
  for (let i = lockStart; i < length; i += 1) {
    for (let j = lockStart; j < length; j += 1) {
      if (i === j) continue;
      const candidate = order.slice();
      const moved = candidate.splice(i, 1);
      candidate.splice(j, 0, ...moved);
      yield candidate;
    }
  }
}

/**
 * Local search: take the first move that makes the route cheaper, start again from the new route, and
 * stop when no move helps or `searchBudget` candidates were tried. A move that breaks an `after`
 * order is rejected before it is priced (§5.11), so the route is valid wherever the search stops.
 */
function improve(
  initial: Visit[],
  lockStart: number,
  cost: (order: readonly Visit[]) => number,
  isAllowed: (order: readonly Visit[]) => boolean,
  searchBudget: number,
): Visit[] {
  let order = initial;
  let best = cost(order);
  let tried = 0;

  let improved = true;
  while (improved) {
    improved = false;
    for (const candidate of neighbours(order, lockStart)) {
      if (tried >= searchBudget) return order;
      tried += 1;
      if (!isAllowed(candidate)) continue;
      const candidateCost = cost(candidate);
      if (candidateCost < best - EPSILON) {
        order = candidate;
        best = candidateCost;
        improved = true;
        break;
      }
    }
  }
  return order;
}
