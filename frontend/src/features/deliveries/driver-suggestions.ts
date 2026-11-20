import { canCarry, haversineMeters, type LatLng, type VehicleClass } from '@instasupply/shared';

import {
  groupActiveByDriver,
  indexById,
  presenceOf,
  type DeliveryRecord,
  type DriverRecord,
  type LocationRecord,
  type Presence,
} from '@/lib/data';

export interface DriverSuggestion {
  driver: DriverRecord;
  location: LocationRecord | null;
  presence: Presence;
  distanceMeters: number | null;
  activeCount: number;
  declined: boolean;
  /** False when the driver's approved vehicle is smaller than the job needs (`VEHICLE_TOO_SMALL`). */
  fits: boolean;
}

/** Each active stop a driver already has counts like this many extra metres of distance. */
const LOAD_PENALTY_METERS = 1500;
const UNKNOWN_DISTANCE_METERS = 50_000;

function score(suggestion: DriverSuggestion): number {
  let value =
    (suggestion.distanceMeters ?? UNKNOWN_DISTANCE_METERS) + suggestion.activeCount * LOAD_PENALTY_METERS;
  if (suggestion.presence === 'stale') value += 1e6;
  if (suggestion.presence === 'offline') value += 1e7;
  if (!suggestion.fits) value += 1e8;
  if (suggestion.declined) value += 1e9;
  return value;
}

/** Whether a driver's approved vehicle can carry a job of `jobClass` (no class: any vehicle). */
export function driverFits(driver: DriverRecord, jobClass: VehicleClass | null | undefined): boolean {
  if (!jobClass) return true;
  const capacity = driver.vehicle?.capacityClass;
  return !!capacity && canCarry(capacity, jobClass);
}

/**
 * Rank approved drivers for a delivery, in any city: vehicles that fit first, then online and close
 * (to the store while the load is not collected), lighter load preferred, drivers who already declined
 * this delivery last.
 */
export function rankDrivers(input: {
  drivers: DriverRecord[];
  locations: LocationRecord[];
  openDeliveries: DeliveryRecord[];
  target: LatLng | null;
  vehicleClass?: VehicleClass | null;
  declinedBy?: string[];
  now: number;
}): DriverSuggestion[] {
  const locations = indexById(input.locations);
  const load = groupActiveByDriver(input.openDeliveries);
  const declined = new Set(input.declinedBy ?? []);

  return input.drivers
    .filter((driver) => driver.status === 'active')
    .map((driver) => {
      const location = locations.get(driver.id) ?? null;
      return {
        driver,
        location,
        presence: presenceOf(location, input.now),
        distanceMeters: location && input.target ? haversineMeters(location, input.target) : null,
        activeCount: load.get(driver.id)?.length ?? 0,
        declined: declined.has(driver.id),
        fits: driverFits(driver, input.vehicleClass),
      };
    })
    .sort((a, b) => score(a) - score(b));
}
