import { formatMoney } from '@instasupply/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Skeleton } from '@/components/ui/Feedback';
import type { IconComponent } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

type Tone = 'brand' | 'warning' | 'success' | 'danger' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600',
  warning: 'bg-amber-50 text-amber-600',
  success: 'bg-emerald-50 text-emerald-600',
  danger: 'bg-rose-50 text-rose-600',
  info: 'bg-sky-50 text-sky-600',
  neutral: 'bg-slate-100 text-slate-500',
};

/**
 * Whole dollars for a KPI ("$4,278"): the cents are shown on the order pages, a tile only needs the
 * figure, and it stays inside its tile at 390 px (ux #5). Formatting is shared's `formatMoney`.
 */
export function Amount({ cents }: { cents: number }) {
  const whole = Math.round(cents / 100) * 100;
  return <span className="tabular-nums">{formatMoney(whole).replace(/\.00$/, '')}</span>;
}

/**
 * The one KPI tile of the ops screens: label, value (a pulsing bar while loading, a dash with a hint
 * on error), an optional hint and link. The value column shrinks before the icon does (container query),
 * so long figures never run under the icon.
 */
export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  to,
  loading,
  failed,
  alert,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: IconComponent;
  tone?: Tone;
  to?: string;
  loading?: boolean;
  /** The source query failed and nothing is cached. */
  failed?: boolean;
  /** Draw the tile with a coloured ring (something needs action). */
  alert?: boolean;
}) {
  const body = (
    <div className="@container flex h-full items-start justify-between gap-2 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
        <div className="mt-1.5 truncate text-xl font-semibold tracking-tight text-slate-900 tabular-nums @[11rem]:text-2xl">
          {loading ? (
            <Skeleton className="h-7 w-16" />
          ) : failed ? (
            <span className="text-slate-400">—</span>
          ) : (
            value
          )}
        </div>
        {failed ? (
          <p className="mt-1 text-xs text-rose-600">Couldn't load</p>
        ) : hint ? (
          <div className="mt-1 line-clamp-2 text-xs text-slate-500">{hint}</div>
        ) : null}
      </div>
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-xl', TONES[tone])}>
        <Icon size={16} aria-hidden />
      </span>
    </div>
  );
  const className = cn(
    'block rounded-2xl border bg-white shadow-card',
    alert ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200/80',
  );
  return to ? (
    <Link to={to} className={cn(className, 'transition-shadow hover:shadow-pop focus-visible:shadow-pop')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
