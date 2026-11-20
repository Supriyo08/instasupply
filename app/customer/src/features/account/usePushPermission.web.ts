/** Web version of ./usePushPermission: the browser app has no system push (docs/CLIENTS.md §6.7). */
import type * as Native from './usePushPermission';

export type { PushPermission } from './usePushPermission';

export const usePushPermission: typeof Native.usePushPermission = () => ({
  status: 'unsupported',
  enable: async () => undefined,
});
