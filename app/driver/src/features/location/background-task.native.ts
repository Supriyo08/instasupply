/**
 * Background location for native builds. Registered at app start (TaskManager requires the task
 * to be defined in the global scope). Not available in Expo Go — the app falls back to
 * foreground tracking there.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { auth } from '@/lib/firebase';

import { publishFix, toFix, type TrackingMode } from './publisher';

export const LOCATION_TASK = 'instasupply-background-location';
const MODE_KEY = 'instasupply.trackingMode';

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await auth.authStateReady();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const mode = ((await AsyncStorage.getItem(MODE_KEY)) as TrackingMode | null) ?? 'normal';
  const latest = data.locations[data.locations.length - 1]!;
  try {
    await publishFix(uid, toFix(latest), { online: true, mode });
  } catch {
    // Offline or token expired: the next update will retry.
  }
});

export async function startBackgroundUpdates(mode: TrackingMode): Promise<boolean> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return false;
    const background = await Location.getBackgroundPermissionsAsync();
    if (!background.granted) return false;
    await AsyncStorage.setItem(MODE_KEY, mode);
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: mode === 'live' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
      timeInterval: mode === 'live' ? 5_000 : 15_000,
      distanceInterval: mode === 'live' ? 10 : 30,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'InstaSupply is sharing your location',
        notificationBody: 'Dispatch and your customers can see your live position while you are online.',
        notificationColor: '#4F46E5',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    // Expo Go or missing native configuration.
    return false;
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
    const result = await Location.requestBackgroundPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}
