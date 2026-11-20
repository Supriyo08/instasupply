/** The injectable clock of the harness (docs/PLATFORM.md §12.2). */
import type { Clock } from '../../src/platform/clock';

/**
 * Thu 2026-11-19 12:25 America/Toronto (17:25 UTC), the reference time of MARKETPLACE §4.8: every seed
 * store is open and ASAP is valid, so fixtures behave the same whatever the wall clock says.
 */
export const REFERENCE_TIME = 1795109100000;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Time stands still until a test moves it, so every timestamp a request writes is predictable. */
export class FakeClock implements Clock {
  private ms: number;

  constructor(start: number = REFERENCE_TIME) {
    this.ms = start;
  }

  now(): number {
    return this.ms;
  }

  set(ms: number): void {
    this.ms = ms;
  }

  advance(ms: number): number {
    this.ms += ms;
    return this.ms;
  }
}
