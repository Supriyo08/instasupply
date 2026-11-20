/**
 * The store behind a delivery's pickup, for its opening hours on the delivery screen (MARKETPLACE §10
 * "Store block: address, hours, phone, loading notes"). The delivery copies the address, phone and
 * loading notes; only the hours come from the public store document.
 */
import { formatClockTime, localDateOf, storeHoursOn, type Store } from '@instasupply/shared';
import { useLiveQuery } from '@instasupply/api-client/react';

import { queries } from '@/lib/api';

export function useStore(storeId: string | null | undefined) {
  return useLiveQuery(queries.store(storeId));
}

/** "Open today 7:00 am–6:00 pm", "Closed today", or null when the hours are not known. */
export function storeHoursText(store: Pick<Store, 'hours' | 'closures'> | null, now: number): string | null {
  if (!store) return null;
  const hours = storeHoursOn(store, localDateOf(now));
  if (!hours) return 'Closed today';
  const open = formatClockTime(hours.open);
  const close = formatClockTime(hours.close);
  if (now < hours.openAt) return `Opens ${open} today, closes ${close}`;
  if (now >= hours.closeAt) return `Closed at ${close} today`;
  return `Open today ${open}–${close}`;
}
