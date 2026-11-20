import { useMemo } from 'react';

import {
  groupActiveByDriver,
  indexById,
  useDriverLocations,
  useDrivers,
  useOpenDeliveries,
} from '@/lib/data';

import type { DriverRow } from './DriverList';

/** Approved drivers joined with their live location and active deliveries. */
export function useFleet() {
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const open = useOpenDeliveries();

  const approved = useMemo(() => drivers.data.filter((driver) => driver.status === 'active'), [drivers.data]);

  const rows = useMemo<DriverRow[]>(() => {
    const locationById = indexById(locations.data);
    const activeByDriver = groupActiveByDriver(open.data);
    return approved.map((driver) => ({
      driver,
      location: locationById.get(driver.id) ?? null,
      active: activeByDriver.get(driver.id) ?? [],
    }));
  }, [approved, locations.data, open.data]);

  return {
    drivers: approved,
    allDrivers: drivers.data,
    locations: locations.data,
    openDeliveries: open.data,
    rows,
    loading: drivers.loading || locations.loading || open.loading,
    error: drivers.error ?? locations.error ?? open.error,
    retry: () => {
      drivers.retry();
      locations.retry();
      open.retry();
    },
  };
}
