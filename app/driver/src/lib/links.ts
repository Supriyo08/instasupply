import type { LatLng } from '@instasupply/shared';
import { Linking, Platform } from 'react-native';

/** Turn-by-turn directions in Google Maps (app if installed, otherwise the web). */
export async function openNavigation(
  destination: LatLng,
  options: { origin?: LatLng | null; waypoints?: LatLng[] } = {},
) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'driving',
  });
  if (options.origin) params.set('origin', `${options.origin.lat},${options.origin.lng}`);
  if (options.waypoints?.length) {
    // Google Maps URLs support up to 9 waypoints.
    params.set(
      'waypoints',
      options.waypoints
        .slice(0, 9)
        .map((point) => `${point.lat},${point.lng}`)
        .join('|'),
    );
  }
  const url = `https://www.google.com/maps/dir/?${params.toString()}`;
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await Linking.openURL(url);
}

export async function callPhone(phone: string) {
  await Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}

export async function textPhone(phone: string, body?: string) {
  const separator = Platform.OS === 'ios' ? '&' : '?';
  await Linking.openURL(
    `sms:${phone.replace(/[^\d+]/g, '')}${body ? `${separator}body=${encodeURIComponent(body)}` : ''}`,
  );
}
