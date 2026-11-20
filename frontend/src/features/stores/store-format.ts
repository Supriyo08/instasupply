/** Store labels and defaults for the ops store screens (MARKETPLACE §1.3 stores, §2.8, §9). */
import type { DayHours, StoreStatus, Weekday } from '@instasupply/shared';

import type { Tone } from '@/components/ui/Badge';

export const STORE_STATUS_META: Record<StoreStatus, { label: string; tone: Tone; hint: string }> = {
  onboarding: {
    label: 'Onboarding',
    tone: 'warning',
    hint: 'Hidden from customers while the catalogue is set up.',
  },
  coming_soon: {
    label: 'Coming soon',
    tone: 'info',
    hint: 'Shown with a "Coming soon" badge; no orders yet.',
  },
  live: { label: 'Live', tone: 'success', hint: 'Customers can order.' },
  closed: { label: 'Closed', tone: 'neutral', hint: 'Hidden from every list; history is kept.' },
};

export const STORE_STATUSES: readonly StoreStatus[] = ['onboarding', 'coming_soon', 'live', 'closed'];

/** A building-supply yard's usual week: Mon–Fri 7–5, Sat 8–2, closed Sunday. */
export function defaultHours(): Record<Weekday, DayHours | null> {
  const weekday = { open: '07:00', close: '17:00' };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { open: '08:00', close: '14:00' },
    sun: null,
  };
}

/** "Kestrel Lumber Yard" → "kestrel-lumber-yard": a store id (3–40 characters, no `--`). */
export function storeSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** Basis points as a percent for an input: 1000 → "10". */
export function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

/** "12.5" → 1250; null when it is not a number from 0 to 50. */
export function percentToBps(value: string): number | null {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) return null;
  return Math.round(percent * 100);
}
