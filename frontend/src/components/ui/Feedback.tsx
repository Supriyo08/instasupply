import { describeError } from '@instasupply/api-client';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { ErrorIcon, SpinnerIcon, type IconComponent } from './icons';

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-slate-500', className)}>
      <SpinnerIcon size={16} className="animate-spin text-brand-600" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}…</span>
    </span>
  );
}

export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid min-h-60 place-items-center">
      <Spinner label={label} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconComponent;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-500">
        <Icon size={20} aria-hidden />
      </div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * "Couldn't load" box. `error` may be an `ApiError`, any `Error` or a message; pass `onRetry` (the
 * query's `retry`) to offer "Try again".
 */
export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this data",
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const message = typeof error === 'string' ? error : describeError(error);
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200',
        className,
      )}
      role="alert"
    >
      <ErrorIcon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-rose-700">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg px-2.5 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-100"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Callout({
  tone = 'info',
  icon: Icon,
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'success' | 'danger';
  icon?: IconComponent;
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-brand-50 text-brand-900 ring-brand-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    danger: 'bg-rose-50 text-rose-900 ring-rose-200',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-xl p-3.5 text-sm ring-1', tones[tone])}>
      {Icon ? <Icon size={18} className="mt-0.5 shrink-0" aria-hidden /> : null}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>
      </div>
    </div>
  );
}
