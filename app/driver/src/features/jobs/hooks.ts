/** The job board (MARKETPLACE §10, docs/CLIENTS.md §4.6). */
import { haversineMeters, toMillis, type JobOffer, type LatLng } from '@instasupply/shared';
import type { WithId } from '@instasupply/api-client';
import { useLiveQuery } from '@instasupply/api-client/react';
import { useMemo } from 'react';

import { useDriver, useSession } from '@/features/auth/SessionProvider';
import { queries } from '@/lib/api';

/** The board key: the driver's city and approved capacity class, both from the profile (set by ops). */
export function useBoardKey(): { cityId: string | null; capacityClass: string | null } {
  const { profile } = useDriver();
  return { cityId: profile.cityId ?? null, capacityClass: profile.vehicle?.capacityClass ?? null };
}

/**
 * Open offers for the driver's city and class, only while the session is `ready` (§4.6). The server
 * returns only offers whose audience matches the caller.
 */
export function useJobBoard() {
  const { status } = useSession();
  const { cityId, capacityClass } = useBoardKey();
  return useLiveQuery(queries.jobBoard(cityId, capacityClass), { enabled: status === 'ready' });
}

/** One offer; `data === null` after loading means "Someone else just took this job" (or it was withdrawn). */
export function useJobOffer(deliveryId: string | undefined) {
  const { cityId, capacityClass } = useBoardKey();
  return useLiveQuery(queries.jobOffer(deliveryId, cityId, capacityClass));
}

/** When the load can be collected: the ready time of the pickup, epoch ms. */
export function readyAtOf(offer: JobOffer): number {
  return toMillis(offer.pickup.readyBy) ?? Number.MAX_SAFE_INTEGER;
}

/** Board order: ready time first, then distance from the driver's last fix to the store. */
export function sortJobs<T extends JobOffer>(offers: readonly T[], from: LatLng | null): T[] {
  const distance = (offer: T) => (from ? haversineMeters(from, offer.pickup.location) : 0);
  return [...offers].sort((a, b) => readyAtOf(a) - readyAtOf(b) || distance(a) - distance(b));
}

export type JobFilter = 'all' | 'ready_now' | 'scheduled' | 'near_me';

/** "Near me": the store within this distance of the last fix. */
export const NEAR_ME_METERS = 15_000;

/** The filter chips of the board (Ready now, Scheduled, Near me) plus the local "Not for me" ids. */
export function useVisibleJobs(
  offers: readonly WithId<JobOffer>[],
  options: { filter: JobFilter; hidden: ReadonlySet<string>; from: LatLng | null; now: number },
): WithId<JobOffer>[] {
  const { filter, hidden, from, now } = options;
  return useMemo(() => {
    const visible = offers.filter((offer) => {
      if (hidden.has(offer.deliveryId)) return false;
      switch (filter) {
        case 'ready_now':
          return offer.pickup.ready || readyAtOf(offer) <= now;
        case 'scheduled':
          return offer.window.kind === 'scheduled';
        case 'near_me':
          return from !== null && haversineMeters(from, offer.pickup.location) <= NEAR_ME_METERS;
        default:
          return true;
      }
    });
    return sortJobs(visible, from);
  }, [offers, filter, hidden, from, now]);
}
