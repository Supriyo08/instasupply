import {
  PRIORITY_META,
  STATUS_META,
  type DeliveryStatus,
  type Priority,
  type StatusTone,
} from '@instasupply/shared';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { UrgentIcon } from './icons';

export type Tone = StatusTone;

export const TONE_CLASSES: Record<Tone, { badge: string; dot: string; hex: string }> = {
  neutral: { badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400', hex: '#64748b' },
  info: { badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500', hex: '#0284c7' },
  brand: { badge: 'bg-brand-50 text-brand-700 ring-brand-200', dot: 'bg-brand-500', hex: '#4f46e5' },
  warning: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500', hex: '#d97706' },
  success: {
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    hex: '#059669',
  },
  danger: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500', hex: '#e11d48' },
};

/** Map-friendly colour for a delivery status. */
export const statusHex = (status: DeliveryStatus) => TONE_CLASSES[STATUS_META[status].tone].hex;

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE_CLASSES[tone].badge,
        className,
      )}
    >
      {dot ? <span className={cn('size-1.5 rounded-full', TONE_CLASSES[tone].dot)} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: DeliveryStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === 'normal') return null;
  return (
    <Badge tone={priority === 'urgent' ? 'danger' : 'warning'}>
      {priority === 'urgent' ? <UrgentIcon size={12} aria-hidden /> : null}
      {PRIORITY_META[priority].label}
    </Badge>
  );
}
