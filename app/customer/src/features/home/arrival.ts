import type { PublicTracking } from '@instasupply/shared';

/** "Arriving in 25 mins" from the live ETA, counted from when the tracking was last updated. */
export function arrivalLabel(
  tracking: Pick<PublicTracking, 'etaSeconds' | 'updatedAt' | 'status'> | null,
  now: number,
) {
  if (!tracking || tracking.etaSeconds == null) return null;
  const arriveAt = tracking.updatedAt + tracking.etaSeconds * 1000;
  const minutes = Math.ceil((arriveAt - now) / 60_000);
  if (minutes <= 1) return 'Arriving any minute';
  return `Arriving in ${minutes} mins`;
}
