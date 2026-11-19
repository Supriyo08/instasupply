import { COLLECTIONS, haversineMeters, type LatLng } from '@instasupply/shared';
import * as Battery from 'expo-battery';
import type { LocationObject } from 'expo-location';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';

export type TrackingMode = 'normal' | 'live';

/** How often positions are written. "live" is used while the driver is heading to a customer. */
export const TRACKING_PROFILES: Record<
  TrackingMode,
  {
    minIntervalMs: number;
    minDistanceM: number;
    heartbeatMs: number;
    watchIntervalMs: number;
    watchDistanceM: number;
  }
> = {
  normal: {
    minIntervalMs: 10_000,
    minDistanceM: 25,
    heartbeatMs: 60_000,
    watchIntervalMs: 10_000,
    watchDistanceM: 20,
  },
  live: {
    minIntervalMs: 4_000,
    minDistanceM: 8,
    heartbeatMs: 20_000,
    watchIntervalMs: 4_000,
    watchDistanceM: 5,
  },
};

export interface Fix extends LatLng {
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  at: number;
}

export function toFix(location: LocationObject): Fix {
  const { latitude, longitude, heading, speed, accuracy } = location.coords;
  return {
    lat: latitude,
    lng: longitude,
    // Platforms report -1 / null when unknown.
    heading: heading != null && heading >= 0 ? heading : null,
    speed: speed != null && speed >= 0 ? speed : null,
    accuracy: accuracy ?? null,
    at: location.timestamp,
  };
}

let batteryCache: { value: number | null; at: number } = { value: null, at: 0 };

async function batteryLevel(): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  if (Date.now() - batteryCache.at < 5 * 60_000) return batteryCache.value;
  try {
    const level = await Battery.getBatteryLevelAsync();
    batteryCache = { value: level >= 0 ? Math.round(level * 100) / 100 : null, at: Date.now() };
  } catch {
    batteryCache = { value: null, at: Date.now() };
  }
  return batteryCache.value;
}

let lastWrite: { fix: Fix; at: number; online: boolean } | null = null;

/** Write a position if it's meaningfully new (throttled per tracking mode). Returns true if written. */
export async function publishFix(
  uid: string,
  fix: Fix,
  options: { online: boolean; mode: TrackingMode; force?: boolean },
) {
  const profile = TRACKING_PROFILES[options.mode];
  const now = Date.now();
  if (!options.force && lastWrite && lastWrite.online === options.online) {
    const elapsed = now - lastWrite.at;
    const moved = haversineMeters(lastWrite.fix, fix);
    const due =
      (elapsed >= profile.minIntervalMs && moved >= profile.minDistanceM) || elapsed >= profile.heartbeatMs;
    if (!due) return false;
  }
  await setDoc(
    doc(db, COLLECTIONS.driverLocations, uid),
    {
      lat: fix.lat,
      lng: fix.lng,
      heading: fix.heading,
      speed: fix.speed,
      accuracy: fix.accuracy,
      online: options.online,
      battery: await batteryLevel(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  lastWrite = { fix, at: now, online: options.online };
  return true;
}

export function resetPublisher() {
  lastWrite = null;
}
