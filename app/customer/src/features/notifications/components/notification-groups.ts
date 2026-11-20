import { startOfDay, toMillis, type AppNotification } from '@instasupply/shared';

export interface NotificationSection {
  title: string;
  data: AppNotification[];
}

/** Splits a newest-first inbox into "Today", "Yesterday" and "Earlier" (empty groups dropped). */
export function groupByDay(items: readonly AppNotification[], now = Date.now()): NotificationSection[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(todayStart - 1);
  const today: AppNotification[] = [];
  const yesterday: AppNotification[] = [];
  const earlier: AppNotification[] = [];
  for (const item of items) {
    // Pending server timestamps count as "now".
    const at = toMillis(item.createdAt) ?? now;
    (at >= todayStart ? today : at >= yesterdayStart ? yesterday : earlier).push(item);
  }
  return [
    { title: 'Today', data: today },
    { title: 'Yesterday', data: yesterday },
    { title: 'Earlier', data: earlier },
  ].filter((section) => section.data.length > 0);
}
