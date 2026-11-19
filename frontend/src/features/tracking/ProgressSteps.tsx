import {
  PROGRESS_STEPS,
  STATUS_META,
  formatClock,
  progressIndex,
  type PublicTracking,
} from '@instasupply/shared';

import { CheckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export function ProgressSteps({ tracking }: { tracking: PublicTracking }) {
  const current = progressIndex(tracking.status);
  const timeOf = (status: string) => tracking.timeline?.find((entry) => entry.status === status)?.at ?? null;

  return (
    <ol className="space-y-0">
      {PROGRESS_STEPS.map((step, index) => {
        const done = current >= index;
        const active = current === index && tracking.status !== 'delivered';
        const at = timeOf(step);
        return (
          <li key={step} className="relative flex gap-3 pb-5 last:pb-0">
            {index < PROGRESS_STEPS.length - 1 ? (
              <span
                className={cn(
                  'absolute top-6 bottom-0 left-[11px] w-0.5',
                  current > index ? 'bg-brand-500' : 'bg-slate-200',
                )}
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                'relative grid size-6 shrink-0 place-items-center rounded-full text-white',
                done ? 'bg-brand-600' : 'bg-slate-200',
                active && 'ring-4 ring-brand-100',
              )}
              aria-hidden
            >
              {done ? <CheckIcon size={13} strokeWidth={3} /> : null}
            </span>
            <div className="flex flex-1 items-baseline justify-between gap-2">
              <span className={cn('text-sm', done ? 'font-medium text-slate-900' : 'text-slate-400')}>
                {STATUS_META[step].customerLabel}
              </span>
              {at && done ? (
                <span className="text-xs text-slate-500 tabular-nums">{formatClock(at)}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
