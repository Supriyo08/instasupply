/**
 * Web version of ./push (Metro picks this file for the browser). The web has no system push:
 * updates arrive through the inbox and the in-app banner, and expo-notifications and expo-device
 * stay out of the web bundle (docs/CLIENTS.md §6.7).
 */
import type * as Native from './push';

export type { PushRegistration } from './push';

export const registerForPush: typeof Native.registerForPush = async () => ({
  status: 'unavailable',
  reason: 'web',
});

export const unregisterDevice: typeof Native.unregisterDevice = async () => undefined;

export const onPushTokenChange: typeof Native.onPushTokenChange = () => () => undefined;
