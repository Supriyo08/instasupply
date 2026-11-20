import { useApiQuery, useLiveQuery } from '@instasupply/api-client/react';
import { useMemo } from 'react';

import { queries } from '@/lib/api';
import { useDriverLocations } from '@/lib/data';

/** A driver's profile (`GET /users/{uid}`), live over the ops drivers topic. */
export function useDriver(driverId: string | undefined) {
  const result = useLiveQuery(queries.user(driverId));
  const { data: profile } = result;
  const data = useMemo(() => (profile ? { ...profile, id: profile.uid } : null), [profile]);
  return { ...result, data };
}

/** A selector over the fleet's location list, so the driver page shares the live map's one subscription. */
export function useDriverLocation(driverId: string | undefined) {
  const locations = useDriverLocations();
  const data = useMemo(
    () => (driverId ? (locations.data.find((item) => item.id === driverId) ?? null) : null),
    [driverId, locations.data],
  );
  return { ...locations, data };
}

/** The driver's deliveries, newest first. */
export function useDriverDeliveries(driverId: string | undefined) {
  return useLiveQuery(queries.driverDeliveries(driverId));
}

/** All-time delivered and failed counts (`GET /deliveries/stats`). */
export function useDriverTotals(driverId: string | undefined) {
  return useApiQuery(queries.deliveryStats(driverId, 0));
}
