import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api, isNetworkError } from '@/lib/api';
import { appVersion, easProjectId } from '@/lib/env';

import { pushAvailability } from './push-availability';

export type PushRegistration =
  | { status: 'registered' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: 'web' | 'expo_go' | 'not_configured' | 'token_failed' };

/**
 * Android channels, created before any permission request (Android 13+ shows no prompt before a
 * channel exists). Ids equal the server's `channelFor`; importance is fixed at creation
 * (docs/CLIENTS.md §6.6), so a change needs a new id.
 */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('orders', {
    name: 'Order updates',
    description: 'Accepted, ready, on the way and delivered',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#6CC51D',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('chat', {
    name: 'Support messages',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('updates', {
    name: 'Account updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync('promotions', {
    name: 'Offers',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Registers this install's Expo push token with the server (docs/CLIENTS.md §6.2). `prompt: false`
 * registers only when permission was granted earlier (every start once the session is ready);
 * `prompt: true` may show the system prompt (order success card, Settings).
 */
export async function registerForPush(options: { prompt: boolean }): Promise<PushRegistration> {
  const availability = pushAvailability();
  if (!availability.available) return { status: 'unavailable', reason: availability.reason };
  if (!Device.isDevice) return { status: 'unavailable', reason: 'not_configured' };
  await ensureChannels().catch(() => undefined);
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && options.prompt && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };
  let token: string;
  try {
    // Needs the network (Expo's servers); a wrong google-services.json still rejects here.
    token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data;
  } catch {
    return { status: 'unavailable', reason: 'token_failed' };
  }
  try {
    await api.devices.register({
      token,
      provider: 'expo',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion,
      deviceName: Device.deviceName ?? Device.modelName ?? null,
    });
  } catch (error) {
    // A network failure is retried at the next start; anything else means the body and the server disagree.
    if (!isNetworkError(error)) console.warn('Push device registration was refused', error);
    return { status: 'unavailable', reason: 'token_failed' };
  }
  return { status: 'registered' };
}

/** Turns pushes to this device off without signing out. Sign-out does not need it (§2.5). */
export async function unregisterDevice(): Promise<void> {
  await api.devices.unregister();
}

/** Calls `listener` when the platform rotates the push token; a no-op without push. */
export function onPushTokenChange(listener: () => void): () => void {
  if (!pushAvailability().available) return () => undefined;
  const subscription = Notifications.addPushTokenListener(() => listener());
  return () => subscription.remove();
}
