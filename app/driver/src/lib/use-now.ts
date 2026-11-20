import { useEffect, useState } from 'react';

import { api } from './api';

/**
 * The server-corrected time, refreshed every `intervalMs` (default 30 s). Use it for every relative time
 * and countdown ("updated 2 min ago", "Ready 12:50 pm", "Accept within 7:42"): the shared formatters
 * take `now` explicitly, and `api.serverNow()` stays right on a phone whose clock is wrong.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => api.serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(api.serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
