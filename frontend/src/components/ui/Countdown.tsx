import { useApi } from '@instasupply/api-client/react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

/** "7:42", "1:05:09"; negative values are shown as their absolute value (the caller says "overdue"). */
export function formatCountdown(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Server-corrected "now" that ticks every `intervalMs`. Use it for countdowns to server deadlines
 * (`respondBy`, `offerValidUntil`, `holdUntil`, quote SLA), so a counter PC with a wrong clock still
 * shows the right time left (CLIENTS §1.4 `serverNow`).
 */
export function useServerNow(intervalMs = 1000): number {
  const api = useApi();
  const [now, setNow] = useState(() => api.serverNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(api.serverNow()), intervalMs);
    return () => window.clearInterval(timer);
  }, [api, intervalMs]);
  return now;
}

/**
 * "Accept within 7:42" style countdown to an epoch-ms deadline. Turns amber under `warnMs` and red
 * under `urgentMs` (the portal's New lane: red under 5 min, MARKETPLACE §8); after the deadline it
 * shows `overdueLabel`.
 */
export function Countdown({
  deadline,
  prefix,
  overdueLabel = 'Overdue',
  warnMs = 10 * 60_000,
  urgentMs = 5 * 60_000,
  className,
}: {
  deadline: number | null | undefined;
  prefix?: string;
  overdueLabel?: string;
  warnMs?: number;
  urgentMs?: number;
  className?: string;
}) {
  const now = useServerNow();
  if (deadline == null) return null;
  const left = deadline - now;
  const tone =
    left <= 0 || left < urgentMs ? 'text-rose-600' : left < warnMs ? 'text-amber-600' : 'text-slate-600';
  return (
    <span className={cn('font-medium tabular-nums', tone, className)} role="timer">
      {left <= 0
        ? `${overdueLabel} ${formatCountdown(left)}`
        : `${prefix ? `${prefix} ` : ''}${formatCountdown(left)}`}
    </span>
  );
}
