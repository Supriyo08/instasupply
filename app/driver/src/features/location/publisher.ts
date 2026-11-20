/**
 * The driver's location publisher (docs/CLIENTS.md §5.1): one `LocationPublisher` per runtime, shared by
 * the foreground watcher and the background task. The throttle, queue, batching, back-off and the
 * stationary heartbeat live in the package (`@instasupply/api-client`), where they are tested.
 */
import { LocationPublisher, TRACKING_PROFILES, type Fix, type TrackingMode } from '@instasupply/api-client';
import * as Battery from 'expo-battery';
import type { LocationObject } from 'expo-location';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

export { TRACKING_PROFILES, type Fix, type TrackingMode };

/** The switch's own key: holds the uid of the driver who is online on this device (code review R67). */
export const ONLINE_KEY = 'instasupply.online';
/** The tracking mode the background task reads (docs/CLIENTS.md §5.5). */
export const MODE_KEY = 'instasupply.trackingMode';

/** 0 to 1, or null. The publisher reads it at most every 5 minutes. */
async function batteryLevel(): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  const level = await Battery.getBatteryLevelAsync();
  return level >= 0 ? Math.round(level * 100) / 100 : null;
}

const holder = globalThis as { __instasupplyPublisher?: LocationPublisher };

/** One publisher per runtime; the holder keeps its queue and throttle across fast refresh. */
export const publisher: LocationPublisher = (holder.__instasupplyPublisher ??= new LocationPublisher(api, {
  battery: batteryLevel,
}));

export function toFix(location: LocationObject): Fix {
  const { latitude, longitude, heading, speed, accuracy } = location.coords;
  return {
    lat: latitude,
    lng: longitude,
    // Platforms report -1 or null when unknown.
    heading: heading != null && heading >= 0 ? heading : null,
    speed: speed != null && speed >= 0 ? speed : null,
    accuracy: accuracy != null && accuracy >= 0 ? accuracy : null,
    at: location.timestamp,
  };
}
