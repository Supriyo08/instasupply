import type { LatLng } from '@instasupply/shared';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { notify } from '@/lib/notify';

import type { AddressDraft } from './address-form';

export interface LocatedPlace {
  location: LatLng;
  /** Address lines from reverse geocoding (iOS/Android only; empty on the web). */
  found: Partial<Pick<AddressDraft, 'line1' | 'line2' | 'city' | 'zip'>>;
}

const POSITION_TIMEOUT_MS = 12_000;

/** Fresh fix with a timeout, falling back to the last known position on phones. */
async function currentPosition(): Promise<Location.LocationObject> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), POSITION_TIMEOUT_MS);
  });
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
    if (fresh) return fresh;
  } finally {
    clearTimeout(timer);
  }
  const last = Platform.OS === 'web' ? null : await Location.getLastKnownPositionAsync();
  if (last) return last;
  throw new Error('Timed out waiting for a location fix.');
}

/** Reverse geocoding is not available on the web, so the shopper types the lines there. */
async function describe(location: LatLng): Promise<LocatedPlace['found']> {
  if (Platform.OS === 'web') return {};
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: location.lat, longitude: location.lng });
    if (!place) return {};
    const street = [place.streetNumber, place.street].filter(Boolean).join(' ');
    return {
      line1: street || place.name || undefined,
      line2: place.district ?? undefined,
      city: place.city ?? place.subregion ?? undefined,
      zip: place.postalCode ?? undefined,
    };
  } catch {
    return {};
  }
}

/** "Use my current location": permission → position → (native) address lines. */
export function useCurrentLocation() {
  const [locating, setLocating] = useState(false);

  const locate = useCallback(async (): Promise<LocatedPlace | null> => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        notify(
          'Location access needed',
          permission.canAskAgain
            ? 'Allow location access to pin your doorstep, or type the address instead.'
            : 'Location access is off for InstaSupply. Turn it on in Settings, or type the address instead.',
        );
        return null;
      }
      if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) {
        notify(
          'Location services are off',
          'Turn on location services to pin your doorstep, or type the address.',
        );
        return null;
      }
      const position = await currentPosition();
      const location = { lat: position.coords.latitude, lng: position.coords.longitude };
      return { location, found: await describe(location) };
    } catch {
      notify(
        "Couldn't find you",
        'We could not get your location. Try again outdoors, or type the address in.',
      );
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

  return { locating, locate };
}
