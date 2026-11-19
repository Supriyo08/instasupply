import {
  ORDER_PROGRESS,
  ORDER_STATUS_META,
  failureReasonLabel,
  formatDateTime,
  type TimestampLike,
} from '@instasupply/shared';

import { CheckIcon, CloseIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { DeliveryRecord, OrderRecord } from '@/lib/data';

type StepState = 'done' | 'current' | 'upcoming' | 'failed' | 'cancelled';

interface Step {
  key: string;
  label: string;
  state: StepState;
  at?: TimestampLike;
  detail?: string | null;
  hint?: string;
}

const MARKER: Record<StepState, string> = {
  done: 'bg-brand-600',
  current: 'bg-brand-600 ring-4 ring-brand-100',
  upcoming: 'bg-slate-200',
  failed: 'bg-rose-500',
  cancelled: 'bg-slate-400',
};

const LABEL: Record<StepState, string> = {
  done: 'font-medium text-slate-900',
  current: 'font-medium text-slate-900',
  upcoming: 'text-slate-400',
  failed: 'font-medium text-rose-700',
  cancelled: 'font-medium text-slate-900',
};

const SR_PREFIX: Record<StepState, string> = {
  done: 'Done: ',
  current: 'Current: ',
  upcoming: 'Not yet: ',
  failed: '',
  cancelled: '',
};

function buildSteps(order: OrderRecord, delivery: DeliveryRecord | null): Step[] {
  const rank = ORDER_PROGRESS.indexOf(order.status);
  const finished = order.status === 'failed' || order.status === 'cancelled';
  const steps: Step[] = [];
  ORDER_PROGRESS.forEach((status, index) => {
    // A failed or cancelled order shows only the steps it actually reached.
    const reached = finished ? !!order.statusAt[status] : index <= rank;
    if (finished && !reached) return;
    steps.push({
      key: status,
      label: ORDER_STATUS_META[status].label,
      state: !reached ? 'upcoming' : index === rank && status !== 'delivered' ? 'current' : 'done',
      at: reached ? order.statusAt[status] : undefined,
    });
  });
  if (order.status === 'failed') {
    const failure = delivery?.status === 'failed' ? delivery.failure : null;
    steps.push({
      key: 'failed',
      label: ORDER_STATUS_META.failed.label,
      state: 'failed',
      at: order.statusAt.failed,
      detail: failure
        ? `${failureReasonLabel(failure.reason)}${failure.note ? ` — ${failure.note}` : ''}`
        : null,
      hint: 'Open the delivery to reassign a driver and retry.',
    });
  }
  if (order.status === 'cancelled') {
    steps.push({
      key: 'cancelled',
      label: ORDER_STATUS_META.cancelled.label,
      state: 'cancelled',
      at: order.statusAt.cancelled,
      detail: order.cancelReason,
    });
  }
  return steps;
}

/** Vertical order timeline (placed → delivered) with the time each step was reached. */
export function OrderProgress({ order, delivery }: { order: OrderRecord; delivery: DeliveryRecord | null }) {
  const steps = buildSteps(order, delivery);

  return (
    <ol aria-label="Order progress">
      {steps.map((step, index) => {
        const next = steps[index + 1];
        return (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
            {next ? (
              <span
                className={cn(
                  'absolute top-6 bottom-0 left-[11px] w-0.5',
                  next.state === 'done' || next.state === 'current' ? 'bg-brand-500' : 'bg-slate-200',
                )}
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                'relative grid size-6 shrink-0 place-items-center rounded-full text-white',
                MARKER[step.state],
              )}
              aria-hidden
            >
              {step.state === 'done' || step.state === 'current' ? (
                <CheckIcon size={13} strokeWidth={3} />
              ) : step.state === 'upcoming' ? null : (
                <CloseIcon size={13} strokeWidth={3} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={cn('text-sm', LABEL[step.state])}>
                  <span className="sr-only">{SR_PREFIX[step.state]}</span>
                  {step.label}
                </p>
                {step.at ? (
                  <p className="text-xs text-slate-500 tabular-nums">{formatDateTime(step.at)}</p>
                ) : null}
              </div>
              {step.detail ? <p className="mt-0.5 text-sm text-slate-700">{step.detail}</p> : null}
              {step.hint ? <p className="mt-0.5 text-xs text-slate-500">{step.hint}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
