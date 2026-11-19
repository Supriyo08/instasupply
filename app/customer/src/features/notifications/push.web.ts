/**
 * Web version of ./push (Metro picks this file for the browser). The web app has no system push:
 * order updates arrive through the in-app inbox and banner, so there is no device to register and
 * expo-notifications and expo-device stay out of the web bundle.
 */
import type * as Native from './push';

export const registerForPush: typeof Native.registerForPush = async () => undefined;

export const unregisterDevice: typeof Native.unregisterDevice = async () => undefined;
