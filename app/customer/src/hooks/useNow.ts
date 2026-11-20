import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * The time, corrected by the server's clock (`api.serverNow()`), refreshed every `intervalMs`, so
 * promises ("Delivery by 1:50 pm"), countdowns and relative times stay current on screen.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => api.serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(api.serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
