import { getInstallationId } from '@instasupply/expo-firebase';
import { COLLECTIONS, type PushProvider } from '@instasupply/shared';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { appVersion, easProjectId } from '@/lib/env';
import { db } from '@/lib/firebase';

/** Android channels must exist before asking for permission (Android 13+). Ids match the backend. */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('orders', {
    name: 'Order updates',
    description: 'Confirmation, out-for-delivery and delivered alerts',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#6CC51D',
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('promotions', {
    name: 'Offers',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Register this device for order-update pushes (Expo push token, or FCM on Android builds). */
export async function registerForPush(uid: string) {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  try {
    let token: string;
    let provider: PushProvider;
    if (easProjectId) {
      token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data;
      provider = 'expo';
    } else if (Platform.OS === 'android') {
      token = String((await Notifications.getDevicePushTokenAsync()).data);
      provider = 'fcm';
    } else {
      return;
    }
    await setDoc(
      doc(db, COLLECTIONS.users, uid, COLLECTIONS.devices, await getInstallationId()),
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
  } catch {
    // Expo Go on Android, or a build without push credentials: the in-app inbox still works.
  }
}

export async function unregisterDevice(uid: string) {
  try {
    await deleteDoc(doc(db, COLLECTIONS.users, uid, COLLECTIONS.devices, await getInstallationId()));
  } catch {
    // Best effort.
  }
}
