import { haversineMeters } from '@instasupply/shared';

import type { ApiClient } from '../client';
import type { Fix, LocationAck, LocationReport, TrackingMode } from '../contract';
import { ApiError, toApiError } from '../errors';

export type { Fix, LocationAck, LocationReport, TrackingMode } from '../contract';

export interface TrackingProfile {
  /** expo-location accuracy for the watcher and the task. */
  accuracy: 'balanced' | 'navigation';
  /** Android `timeInterval` for the watcher and the task, ms. */
  watchIntervalMs: number;
  /** `deferredUpdatesInterval` of the background task: how long the OS batches fixes, ms. */
  deferIntervalMs: number;
  /** A moving fix is accepted when at least this much time and distance passed since the last accepted one. */
  minIntervalMs: number;
  minDistanceM: number;
  /** Without movement, one fix is accepted this often, so the driver stays "online" on every screen. */
  heartbeatMs: number;
}

/** CLIENTS §5.3. `distanceInterval` is always 0, so fixes keep arriving while the truck stands still. */
export const TRACKING_PROFILES: Readonly<Record<TrackingMode, TrackingProfile>> = {
  normal: {
    accuracy: 'balanced',
    watchIntervalMs: 15_000,
    deferIntervalMs: 30_000,
    minIntervalMs: 10_000,
    minDistanceM: 25,
    heartbeatMs: 60_000,
  },
  live: {
    accuracy: 'navigation',
    watchIntervalMs: 4_000,
    deferIntervalMs: 8_000,
    minIntervalMs: 4_000,
    minDistanceM: 8,
    heartbeatMs: 20_000,
  },
};

export type PublishOutcome = 'sent' | 'queued' | 'skipped' | 'stopped';

export interface PublisherState {
  lastAccepted: Fix | null;
  lastSentAt: number | null;
  queued: number;
  stopped: 'session' | 'forbidden' | null;
  lastError: ApiError | null;
}

/** A fix worse than this is ignored unless a heartbeat is due. */
export const MAX_ACCURACY_M = 150;
/** Back-off after no answer, a timeout or a 5xx: 5, 10, 20, 40, then 60 s. */
export const PUBLISH_BACKOFF_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, 60_000];
const RATE_LIMIT_DEFAULT_MS = 10_000;
const BATTERY_MAX_AGE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class LocationPublisher {
  private readonly maxQueue: number;
  private readonly maxFixAgeMs: number;
  private queue: Fix[] = [];
  private lastAccepted: Fix | null = null;
  private lastAcceptedOnline: boolean | null = null;
  private lastSentAt: number | null = null;
  private stopped: PublisherState['stopped'] = null;
  private lastError: ApiError | null = null;
  private inflight = false;
  private notBefore = 0;
  private backoffIndex = 0;
  private online = true;
  private battery: { value: number | null; at: number } | null = null;
  private state: PublisherState;
  private readonly listeners = new Set<(state: PublisherState) => void>();

  constructor(
    private readonly client: ApiClient,
    private readonly options: { battery?: () => Promise<number | null>; maxQueue?: number; maxFixAgeMs?: number } = {},
  ) {
    this.maxQueue = options.maxQueue ?? 20;
    this.maxFixAgeMs = options.maxFixAgeMs ?? 5 * 60_000;
    this.state = this.snapshot();
  }

  getState(): PublisherState {
    return this.state;
  }

  subscribe(listener: (state: PublisherState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Foreground watcher and background task both call this. Never throws. */
  async ingest(fixes: readonly Fix[], options: { mode: TrackingMode; force?: boolean }): Promise<PublishOutcome> {
    try {
      if (this.stopped) return 'stopped';
      const profile = TRACKING_PROFILES[options.mode];
      let accepted = 0;
      for (const fix of [...fixes].sort((a, b) => a.at - b.at)) {
        if (this.accept(fix, profile, options.force === true)) accepted += 1;
      }
      this.trimQueue();
      this.emit();
      const flushed = await this.flush(options.mode, options.force === true);
      if (flushed !== null) return flushed;
      if (this.stopped) return 'stopped';
      return accepted > 0 || this.queue.length > 0 ? 'queued' : 'skipped';
    } catch (error) {
      this.lastError = toApiError(error);
      this.emit();
      return this.stopped ? 'stopped' : 'queued';
    }
  }

  /**
   * Sends at once, outside the throttle: going online (with the first fix) and going offline (with the
   * last one). The server exempts a change of `online` from its 2-second limit; on `resource-exhausted`
   * this retries once after `details.retryAfterMs`. Rejects when the request still fails.
   */
  async setOnline(online: boolean, fix: Fix | null, mode: TrackingMode): Promise<LocationAck> {
    if (online) this.stopped = null;
    this.online = online;
    const fixes = fix ? [fix] : [];
    const report: LocationReport = { online, mode, battery: await this.readBattery(), fixes };
    const send = () => this.client.location.publish(report, { timeoutMs: REQUEST_TIMEOUT_MS });
    let ack: LocationAck;
    try {
      try {
        ack = await send();
      } catch (error) {
        const e = toApiError(error);
        if (e.status !== 'resource-exhausted') throw e;
        await this.sleep(retryAfter(e));
        ack = await send();
      }
    } catch (error) {
      const e = toApiError(error);
      this.lastError = e;
      if (e.status === 'unauthenticated') this.stop('session');
      else if (e.status === 'permission-denied') this.stop('forbidden');
      this.emit();
      throw e;
    }
    this.lastSentAt = this.client.clock.now();
    this.lastAcceptedOnline = online;
    if (fix) this.lastAccepted = fix;
    this.lastError = null;
    if (online && !ack.online) this.stop('forbidden');
    this.emit();
    return ack;
  }

  /** Forget the last accepted fix and the queue (after going offline, after sign-out). */
  reset(): void {
    this.queue = [];
    this.lastAccepted = null;
    this.lastAcceptedOnline = null;
    this.lastSentAt = null;
    this.stopped = null;
    this.lastError = null;
    this.notBefore = 0;
    this.backoffIndex = 0;
    this.online = true;
    this.emit();
  }

  // ---------- rules of CLIENTS §5.3 ----------

  private accept(fix: Fix, profile: (typeof TRACKING_PROFILES)[TrackingMode], force: boolean): boolean {
    const last = this.lastAccepted;
    const elapsed = last ? fix.at - last.at : Number.POSITIVE_INFINITY;
    const heartbeatDue = elapsed >= profile.heartbeatMs;
    // Rule 1: a wild fix (cell tower) would make the marker jump; only a due heartbeat may use it.
    if (!force && fix.accuracy !== null && fix.accuracy > MAX_ACCURACY_M && !heartbeatDue) return false;
    const moved = last ? haversineMeters(last, fix) : Number.POSITIVE_INFINITY;
    const ok =
      force ||
      last === null ||
      this.lastAcceptedOnline !== this.online ||
      (elapsed >= profile.minIntervalMs && moved >= profile.minDistanceM) ||
      heartbeatDue;
    if (!ok) return false;
    this.queue.push(fix);
    this.lastAccepted = fix;
    this.lastAcceptedOnline = this.online;
    return true;
  }

  /** At most `maxQueue` fixes; one older than `maxFixAgeMs` behind a newer one is of no use on a map. */
  private trimQueue(): void {
    const newest = this.queue[this.queue.length - 1];
    if (newest) this.queue = this.queue.filter((fix) => fix === newest || newest.at - fix.at <= this.maxFixAgeMs);
    if (this.queue.length > this.maxQueue) this.queue = this.queue.slice(-this.maxQueue);
  }

  /** Rule 4. Null when nothing was sent (throttle, back-off, a report in flight, nothing queued). */
  private async flush(mode: TrackingMode, force: boolean): Promise<PublishOutcome | null> {
    if (this.inflight || this.queue.length === 0) return null;
    const now = this.client.clock.now();
    const profile = TRACKING_PROFILES[mode];
    if (now < this.notBefore) return null;
    if (!force && this.lastSentAt !== null && now - this.lastSentAt < profile.minIntervalMs) return null;
    const batch = this.queue.slice();
    this.inflight = true;
    try {
      const report: LocationReport = { online: this.online, mode, battery: await this.readBattery(), fixes: batch };
      const ack = await this.client.location.publish(report, { timeoutMs: REQUEST_TIMEOUT_MS });
      this.queue = this.queue.filter((fix) => !batch.includes(fix));
      this.lastSentAt = this.client.clock.now();
      this.backoffIndex = 0;
      this.notBefore = 0;
      this.lastError = null;
      if (!ack.online) {
        this.stop('forbidden');
        return 'stopped';
      }
      return 'sent';
    } catch (error) {
      const e = toApiError(error);
      this.lastError = e;
      switch (e.status) {
        case 'resource-exhausted':
          this.notBefore = this.client.clock.now() + retryAfter(e);
          return null;
        case 'invalid-argument':
          // One bad fix must not block the queue: drop the batch.
          this.queue = this.queue.filter((fix) => !batch.includes(fix));
          return null;
        case 'unauthenticated':
          this.stop('session');
          return 'stopped';
        case 'permission-denied':
          this.stop('forbidden');
          return 'stopped';
        default: {
          const delay = PUBLISH_BACKOFF_MS[Math.min(this.backoffIndex, PUBLISH_BACKOFF_MS.length - 1)] ?? 60_000;
          this.backoffIndex += 1;
          this.notBefore = this.client.clock.now() + delay;
          return null;
        }
      }
    } finally {
      this.inflight = false;
      this.emit();
    }
  }

  private stop(reason: 'session' | 'forbidden'): void {
    this.stopped = reason;
    this.queue = [];
  }

  private async readBattery(): Promise<number | null> {
    const read = this.options.battery;
    if (!read) return null;
    const now = this.client.clock.now();
    if (this.battery && now - this.battery.at < BATTERY_MAX_AGE_MS) return this.battery.value;
    try {
      this.battery = { value: await read(), at: now };
    } catch {
      this.battery = { value: null, at: now };
    }
    return this.battery.value;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.client.clock.setTimeout(resolve, ms));
  }

  private snapshot(): PublisherState {
    return {
      lastAccepted: this.lastAccepted,
      lastSentAt: this.lastSentAt,
      queued: this.queue.length,
      stopped: this.stopped,
      lastError: this.lastError,
    };
  }

  private emit(): void {
    const next = this.snapshot();
    const prev = this.state;
    if (
      prev.lastAccepted === next.lastAccepted &&
      prev.lastSentAt === next.lastSentAt &&
      prev.queued === next.queued &&
      prev.stopped === next.stopped &&
      prev.lastError === next.lastError
    ) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}

function retryAfter(error: ApiError): number {
  const value = error.details.retryAfterMs;
  return typeof value === 'number' && value >= 0 ? value : RATE_LIMIT_DEFAULT_MS;
}
