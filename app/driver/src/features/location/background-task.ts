/** Web has no background location; the browser tab must stay open while online. */
import type { TrackingMode } from './publisher';

export const LOCATION_TASK = 'instasupply-background-location';

export function parseMode(value: string | null): TrackingMode {
  return value === 'live' ? 'live' : 'normal';
}

export async function startBackgroundUpdates(_mode: TrackingMode): Promise<boolean> {
  return false;
}

export async function stopBackgroundUpdates(): Promise<void> {}

export async function requestBackgroundPermission(): Promise<boolean> {
  return false;
}
