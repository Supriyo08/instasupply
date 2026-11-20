/**
 * Background location (docs/CLIENTS.md §5.5). Defined at bundle evaluation by `index.ts`, before the
 * router loads, so the task exists when Android starts the bundle headlessly to deliver updates after
 * the process was killed (code review R60, R62). Not available in Expo Go: the provider then falls
 * back to the foreground watcher.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { api } from '@/lib/api';

import { MODE_KEY, ONLINE_KEY, publisher, toFix, TRACKING_PROFILES, type TrackingMode } from './publisher';

export const LOCATION_TASK = 'instasupply-background-location';

/** A queued OS batch can be old when a killed process is restarted: an old position is of no use on a map. */
const MAX_FIX_AGE_MS = 2 * 60_000;

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  // No UI may be running. This reads the stored session once per runtime and opens no socket.
  const session = await api.session.whenRestored();
  if (session.status !== 'signed_in' || !session.user) return stopBackgroundUpdates();
  // Self-guard (code review R62, R68, R69): publish only for the driver who turned the switch on.
  // The key is written before the task is started and removed before it is stopped.
  const onlineFor = await AsyncStorage.getItem(ONLINE_KEY);
  if (onlineFor !== session.user.uid) return stopBackgroundUpdates();
  const mode = parseMode(await AsyncStorage.getItem(MODE_KEY));
  const now = Date.now();
  const fixes = data.locations.map(toFix).filter((fix) => now - fix.at <= MAX_FIX_AGE_MS);
  if (fixes.length === 0) return;
  const outcome = await publisher.ingest(fixes, { mode });
  if (outcome === 'stopped') await stopBackgroundUpdates();
});

export function parseMode(value: string | null): TrackingMode {
  return value === 'live' ? 'live' : 'normal';
}

/**
 * Starts the task, or re-registers it with new options when it already runs (a mode change): never call
 * `stopBackgroundUpdates` first. Must run while the app is active: Android refuses to start the foreground
 * service from the background. Returns false when background updates are not possible here.
 */
export async function startBackgroundUpdates(mode: TrackingMode): Promise<boolean> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return false;
    if (!(await Location.getBackgroundPermissionsAsync()).granted) return false;
    const profile = TRACKING_PROFILES[mode];
    await AsyncStorage.setItem(MODE_KEY, mode);
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy:
        profile.accuracy === 'navigation' ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
      timeInterval: profile.watchIntervalMs,
      // 0: fixes keep arriving while the truck stands still; the publisher keeps one per heartbeat (R57, R63, R64).
      distanceInterval: 0,
      deferredUpdatesInterval: profile.deferIntervalMs,
      deferredUpdatesDistance: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'InstaSupply is sharing your location',
        notificationBody: 'Dispatch, stores and your customers can see where you are while you are online.',
        notificationColor: '#4F46E5',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    return false; // Expo Go, or a build without the location plugin options.
  }
}

export async function stopBackgroundUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Nothing to stop.
  }
}

export async function requestBackgroundPermission(): Promise<boolean> {
  try {
    return (await Location.requestBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
