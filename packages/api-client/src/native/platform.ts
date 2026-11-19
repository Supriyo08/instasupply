import type { PlatformBindings } from '../platform';
import { createWebPlatform } from '../web';

/** Expo web: the browser bindings. Android and iOS resolve `platform.native.ts` instead. */
export function createNativePlatform(): PlatformBindings {
  return createWebPlatform();
}
