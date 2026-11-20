/**
 * Concurrency helpers (docs/PLATFORM.md §12.3). Requests sent together over `app.inject` run on separate
 * pool connections, so they contend on real row locks; hold points make the hard interleavings repeatable.
 */
import type { Hooks } from '../../src/container';

interface Gate {
  reached: () => void;
  released: Promise<void>;
}

/** `deps.hooks` in tests: `at(point)` waits at a gate a test has set with `hold`, and is a no-op otherwise. */
export class TestHooks implements Hooks {
  private readonly gates = new Map<string, Gate[]>();
  /** Every point reached, in order, so a test can assert that a code path ran. */
  readonly visited: string[] = [];

  async at(point: string): Promise<void> {
    this.visited.push(point);
    const queue = this.gates.get(point);
    const gate = queue?.shift();
    if (!gate) return;
    if (queue && queue.length === 0) this.gates.delete(point);
    gate.reached();
    await gate.released;
  }

  /** Stops the next request that reaches `point` (one request per call; call again to stop another). */
  hold(point: string): HeldPoint {
    let release!: () => void;
    let reached!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
    const queue = this.gates.get(point) ?? [];
    queue.push({ reached, released });
    this.gates.set(point, queue);
    let wasReached = false;
    void reachedPromise.then(() => (wasReached = true));
    return {
      point,
      reached: (timeoutMs = 5000) => withTimeout(reachedPromise, timeoutMs, `no request reached ${point}`),
      isReached: () => wasReached,
      release,
    };
  }
}

export interface HeldPoint {
  point: string;
  /** Resolves once a request waits at the point; rejects after `timeoutMs` so a test cannot hang. */
  reached(timeoutMs?: number): Promise<void>;
  isReached(): boolean;
  release(): void;
}

/** The context shape these helpers need, so they work with any test context that carries TestHooks. */
export interface HasHooks {
  hooks: TestHooks;
}

/** `hold(ctx, 'placeOrder:afterAuthorize')` (§12.3): hold request A there, let B finish, then release A. */
export function hold(ctx: HasHooks, point: string): HeldPoint {
  return ctx.hooks.hold(point);
}

/** Runs `n` calls of `fn` at once and waits for all of them (every call is started before any is awaited). */
export function concurrently<T>(n: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_, index) => fn(index)));
}

/** Starts every function at once and returns their results in order. */
export function together<T>(fns: readonly (() => Promise<T>)[]): Promise<T[]> {
  return Promise.all(fns.map((fn) => fn()));
}

export interface RaceOptions<S, T> {
  /** How often the pair runs (§12.3: 25). */
  times?: number;
  /** Fresh data for one round, so a round never depends on what the previous one left behind. */
  setup: (round: number) => Promise<S>;
  /** The requests to start together. */
  run: (state: S, round: number) => readonly (() => Promise<T>)[];
  /** The invariant; it must hold whatever the interleaving. */
  check: (results: T[], state: S, round: number) => void | Promise<void>;
}

/** Repeats a concurrent run `times` times on fresh data and checks the invariant every time (§12.3). */
export async function race<S, T>(options: RaceOptions<S, T>): Promise<void> {
  const times = options.times ?? 25;
  for (let round = 0; round < times; round += 1) {
    const state = await options.setup(round);
    const results = await together(options.run(state, round));
    try {
      await options.check(results, state, round);
    } catch (error) {
      // The round number is what makes a rare interleaving reproducible from the failure message.
      if (error instanceof Error) error.message = `race round ${round + 1}/${times}: ${error.message}`;
      throw error;
    }
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
