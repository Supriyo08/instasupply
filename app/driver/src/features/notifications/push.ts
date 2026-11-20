/**
 * Expo push registration (docs/CLIENTS.md §6.2, §6.3). Every push API sits behind `pushAvailability()`,
 * so an APK without google-services.json or EAS_PROJECT_ID never calls one and never throws.
 * `push.web.ts` replaces this file on the web, which keeps expo-notifications out of that bundle.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api, isNetworkError } from '@/lib/api';
import { appVersion, easProjectId } from '@/lib/env';

import { pushAvailability } from './push-availability';

// Foreground presentation, set at startup (this module is loaded by the root layout), so onboarding
// behaves like the signed-in area: the in-app banner covers foreground alerts (§6.4 step 1). Safe in Expo Go.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistration =
  | { status: 'registered' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: 'web' | 'expo_go' | 'not_configured' | 'token_failed' };

/**
 * Android channels (§6.6). Ids equal the server's `channelFor`. Importance is fixed at creation:
 * a different importance later needs a new id. Created before any permission request (Android 13+).
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('jobs', {
    name: 'New jobs',
    description: 'Job offers near you and changes to them',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#4F46E5',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('assignments', {
    name: 'Assignments',
    description: 'Jobs dispatch gives you, removes or cancels',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#4F46E5',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('chat', {
    name: 'Messages from dispatch',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('updates', {
    name: 'Updates',
    description: 'Payouts, vehicle reviews and your account',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** `prompt: false` registers only when permission was granted earlier. */
export async function registerForPush(options: { prompt: boolean }): Promise<PushRegistration> {
  const availability = pushAvailability();
  if (!availability.available) return { status: 'unavailable', reason: availability.reason };

  await ensureChannels();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && options.prompt && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data;
  } catch {
    // Offline at first start, or wrong credentials in the build: tried again at the next start.
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
    // A network failure is retried at the next start; anything else means the body and the server
    // disagree, which must never be swallowed silently (§6.2 step 5).
    if (!isNetworkError(error)) console.warn('[push] device registration failed', error);
    throw error;
  }
  return { status: 'registered' };
}

/** Subscribes to token rotation (guarded by availability). Returns the unsubscribe. */
export function onPushTokenChange(listener: () => void): () => void {
  if (!pushAvailability().available) return () => undefined;
  const subscription = Notifications.addPushTokenListener(listener);
  return () => subscription.remove();
}

/** Turns pushes to this device off without signing out. Sign-out does not need it (§2.5). */
export async function unregisterDevice(): Promise<void> {
  await api.devices.unregister();
}

/** The current permission, for the profile screen's notification note. */
export async function pushPermission(): Promise<'granted' | 'ask' | 'blocked' | 'unavailable'> {
  if (!pushAvailability().available) return 'unavailable';
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return 'granted';
  return permission.canAskAgain ? 'ask' : 'blocked';
}
