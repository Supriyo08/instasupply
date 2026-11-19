import { COLLECTIONS, type PushProvider } from '@instasupply/shared';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { appVersion, easProjectId } from '@/lib/env';
import { db } from '@/lib/firebase';
import { getInstallationId } from '@/lib/installation';

export type PushRegistration =
  | { status: 'registered'; provider: PushProvider }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string };

/** Android channels must exist before asking for permission (Android 13+). Ids match the backend. */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('assignments', {
    name: 'New deliveries',
    description: 'Assignments, cancellations and route changes',
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
    name: 'Delivery updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function saveDevice(uid: string, token: string, provider: PushProvider) {
  const installationId = await getInstallationId();
  await setDoc(
    doc(db, COLLECTIONS.users, uid, COLLECTIONS.devices, installationId),
    {
      token,
      provider,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion,
      deviceName: Device.deviceName ?? Device.modelName ?? null,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Register this device for push. Uses an Expo push token when an EAS project id is configured
 * (works for iOS and Android), otherwise the native FCM token on Android builds.
 */
export async function registerForPush(uid: string): Promise<PushRegistration> {
  if (Platform.OS === 'web')
    return { status: 'unsupported', reason: 'Push is not available in the browser.' };
  if (!Device.isDevice) return { status: 'unsupported', reason: 'Push needs a physical device.' };

  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return { status: 'denied' };

  try {
    if (easProjectId) {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
      await saveDevice(uid, data, 'expo');
      return { status: 'registered', provider: 'expo' };
    }
    if (Platform.OS === 'android') {
      const { data } = await Notifications.getDevicePushTokenAsync();
      await saveDevice(uid, String(data), 'fcm');
      return { status: 'registered', provider: 'fcm' };
    }
    return { status: 'unsupported', reason: 'Set EAS_PROJECT_ID to enable push on iOS.' };
  } catch {
    // Expo Go on Android, or a build without google-services.json.
    return { status: 'unsupported', reason: 'Push needs a development or production build.' };
  }
}

/** Stop pushes to this device (called on sign-out). */
export async function unregisterDevice(uid: string) {
  try {
    await deleteDoc(doc(db, COLLECTIONS.users, uid, COLLECTIONS.devices, await getInstallationId()));
  } catch {
    // Best effort.
  }
}
