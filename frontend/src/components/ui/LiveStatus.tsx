import { useLiveStatus } from '@instasupply/api-client/react';

import { OfflineIcon } from './icons';

/**
 * A thin bar while the live socket is down: data still refreshes by polling (every 10–60 s per
 * screen), so the console says so instead of looking frozen. Hidden while open or connecting.
 */
export function LiveStatusBar() {
  const { state, online } = useLiveStatus();
  if (online && state !== 'waiting' && state !== 'offline') return null;
  const text = online
    ? 'Live updates are reconnecting. Lists refresh every few seconds until then.'
    : "You're offline. What you see may be out of date.";
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
    >
      <OfflineIcon size={14} aria-hidden />
      {text}
    </div>
  );
}
