/**
 * Shared pieces of the console's "something new arrived" alerts (the notification toasts of
 * `useNotificationAlerts` and the portal board's `useNewOrderAlerts`).
 */
import type { AppNotification } from '@instasupply/shared';

/**
 * The ids to announce in a new answer. The first usable answer only fills the seen set, so opening a page
 * never announces what was already there. Callers pass `known = null` until that first answer; an answer
 * that is loading or an error is not usable and must not be passed (an error's empty list would make
 * every waiting item "new" once the retry succeeds).
 */
export function freshIds(
  known: ReadonlySet<string> | null,
  ids: readonly string[],
): { known: Set<string>; fresh: string[] } {
  if (known === null) return { known: new Set(ids), fresh: [] };
  const next = new Set(known);
  const fresh: string[] = [];
  for (const id of ids) {
    if (next.has(id)) continue;
    next.add(id);
    fresh.push(id);
  }
  return { known: next, fresh };
}

/**
 * Notification types another, more specific alert announces while it is mounted (the portal board chimes,
 * toasts and raises a desktop notification for each new store order, so the generic
 * `store_order_new` toast would announce the same order twice).
 */
const claims = new Map<AppNotification['type'], number>();

/** Claims `type` until the returned release is called (use it as an effect's cleanup). */
export function claimNotificationAlerts(type: AppNotification['type']): () => void {
  claims.set(type, (claims.get(type) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (claims.get(type) ?? 1) - 1;
    if (left > 0) claims.set(type, left);
    else claims.delete(type);
  };
}

export function isNotificationAlertClaimed(type: AppNotification['type']): boolean {
  return (claims.get(type) ?? 0) > 0;
}
