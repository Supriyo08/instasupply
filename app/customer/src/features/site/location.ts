import type { LatLng } from '@instasupply/shared';
import { isInServiceArea, r6 } from '@instasupply/shared';
import * as Location from 'expo-location';

export type LocateResult =
  | { ok: true; location: LatLng }
  | { ok: false; reason: 'denied' | 'unavailable' | 'outside_area'; message: string };

const TIMEOUT_MS = 12_000;

/**
 * The device's position for "Use current location" (site sheet, jobsite editor). Asks for the
 * when-in-use permission on first use; works on web through the browser's geolocation.
 */
export async function locateMe(): Promise<LocateResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return {
        ok: false,
        reason: 'denied',
        message: 'Allow location access, or search for an address instead.',
      };
    }
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    const fix = position ?? (await Location.getLastKnownPositionAsync().catch(() => null));
    if (!fix) return { ok: false, reason: 'unavailable', message: "Couldn't find your location. Try again." };
    const location = r6({ lat: fix.coords.latitude, lng: fix.coords.longitude });
    if (!isInServiceArea(location)) {
      return {
        ok: false,
        reason: 'outside_area',
        message: 'InstaSupply delivers in the Greater Toronto Area only.',
      };
    }
    return { ok: true, location };
  } catch {
    return { ok: false, reason: 'unavailable', message: "Couldn't find your location. Try again." };
  }
}
