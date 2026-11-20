import { useConfig, useLiveQuery } from '@instasupply/api-client/react';
import { useCallback } from 'react';

import { queries } from '@/lib/api';

/** One delivery, live. `data` is null while loading and when it does not exist (check `loading` and `error`). */
export function useDelivery(deliveryId: string | undefined) {
  return useLiveQuery(queries.delivery(deliveryId));
}

/** The delivery's timeline, newest first (the latest 30 events). */
export function useDeliveryEvents(deliveryId: string | undefined) {
  return useLiveQuery(queries.deliveryEvents(deliveryId));
}

/** Tracking token and hand-off code (staff only). */
export function usePrivateMeta(deliveryId: string | undefined) {
  return useLiveQuery(queries.deliveryPrivate(deliveryId));
}

/** The public tracking link of a token on this console, when the server's config is not loaded yet. */
export const trackingUrl = (token: string) => `${window.location.origin}/track/${encodeURIComponent(token)}`;

/** Builds tracking links from the server's `trackingBaseUrl` (the link the customer's SMS carries). */
export function useTrackingUrl(): (token: string) => string {
  const base = useConfig()?.trackingBaseUrl?.replace(/\/+$/, '') ?? null;
  return useCallback(
    (token: string) => (base ? `${base}/${encodeURIComponent(token)}` : trackingUrl(token)),
    [base],
  );
}
