import {
  formatClockET,
  type DeliveryStatus,
  type PublicTracking,
  type TrackingPhase,
} from '@instasupply/shared';

import { CheckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/** How far along each phase is (MARKETPLACE §1.3 `TrackingPhase`). */
const PHASE_RANK: Record<TrackingPhase, number> = {
  finding_driver: 0,
  driver_assigned: 1,
  to_store: 2,
  at_store: 2,
  loaded: 3,
  to_site: 4,
  at_site: 4,
  delivered: 5,
  problem: -1,
  cancelled: -1,
};

interface Step {
  rank: number;
  label: string;
  /** Statuses whose timeline time is shown on this step (the first one found). */
  statuses: DeliveryStatus[];
}

function stepsFor(tracking: PublicTracking): Step[] {
  const store = tracking.pickup?.storeName;
  const steps: Step[] = [{ rank: 1, label: 'Driver assigned', statuses: ['assigned', 'accepted'] }];
  if (store) {
    steps.push({ rank: 2, label: `Heading to ${store}`, statuses: ['accepted'] });
    steps.push({ rank: 3, label: `Loaded at ${store}`, statuses: ['picked_up'] });
  } else {
    steps.push({ rank: 3, label: 'Load on board', statuses: ['picked_up'] });
  }
  steps.push({ rank: 4, label: 'On the way to your site', statuses: ['in_transit', 'arrived'] });
  steps.push({ rank: 5, label: 'Delivered', statuses: ['delivered'] });
  return steps;
}

/** The trip's steps, from the driver being assigned to the drop-off, with Toronto times. */
export function ProgressSteps({ tracking }: { tracking: PublicTracking }) {
  const current = PHASE_RANK[tracking.phase];
  const steps = stepsFor(tracking);
  const timeOf = (statuses: DeliveryStatus[]) =>
    tracking.timeline?.find((entry) => statuses.includes(entry.status))?.at ?? null;

  return (
    <ol className="space-y-0" aria-label="Delivery progress">
      {steps.map((step, index) => {
        const done = current >= step.rank;
        const active =
          done && (steps[index + 1] ? current < steps[index + 1]!.rank : tracking.phase !== 'delivered');
        const at = timeOf(step.statuses);
        return (
          <li
            key={step.label}
            className="relative flex gap-3 pb-5 last:pb-0"
            aria-current={active ? 'step' : undefined}
          >
            {index < steps.length - 1 ? (
              <span
                className={cn(
                  'absolute top-6 bottom-0 left-[11px] w-0.5',
                  current > step.rank ? 'bg-brand-500' : 'bg-slate-200',
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
                {step.label}
                <span className="sr-only">{done ? ' (done)' : ' (to come)'}</span>
              </span>
              {at && done ? (
                <span className="text-xs text-slate-500 tabular-nums">{formatClockET(at)}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
