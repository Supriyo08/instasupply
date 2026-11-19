/**
 * Web version of ./usePushListeners (Metro picks this file for the browser). There is no system
 * push on the web, so nothing is registered or listened to and expo-notifications is not bundled.
 */
import type * as Native from './usePushListeners';

export const usePushListeners: typeof Native.usePushListeners = () => undefined;
