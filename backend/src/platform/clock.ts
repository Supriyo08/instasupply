/** One clock per command (docs/PLATFORM.md §3.1): read once, used for every timestamp the command writes. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
