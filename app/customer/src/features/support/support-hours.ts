import { isStoreOpenAt, nextOpeningAt, SUPPORT_HOURS, type HoursSchedule } from '@instasupply/shared';

import { dayAndClock } from '@/features/orders/order-format';

const SUPPORT: HoursSchedule = { hours: SUPPORT_HOURS, closures: [] };

export const SUPPORT_HOURS_TEXT = 'Mon–Fri 7 am–6 pm, Sat 8 am–2 pm';

/** The hours banner of the support chat: online now, or when the team is back. */
export function supportHoursBanner(now: number): { online: boolean; title: string; message: string } {
  if (isStoreOpenAt(SUPPORT, now)) {
    return {
      online: true,
      title: "We're online",
      message: `The InstaSupply team usually replies within a few minutes. ${SUPPORT_HOURS_TEXT}.`,
    };
  }
  const opens = nextOpeningAt(SUPPORT, now);
  return {
    online: false,
    title: "We're offline right now",
    message: `Leave a message and we'll reply${opens != null ? ` from ${dayAndClock(opens, now)}` : ' when we open'}. ${SUPPORT_HOURS_TEXT}.`,
  };
}
