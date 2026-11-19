/**
 * The driver job board (§1.3, §2.4). A job offer is a copy of a delivery with everything a driver
 * needs to decide and nothing that identifies the customer (D9): no name, no phone, no exact address.
 * It exists only while its delivery is unassigned and the store has accepted the order.
 */
import type { SellUnit } from './catalog';
import type { CityId } from './market';
import type { LatLng, TimestampLike } from './types';
import { VEHICLE_CLASS_IDS, canCarry, type DriverPayout, type VehicleClass } from './vehicles';

/** `jobOffers/{deliveryId}`. */
export interface JobOffer {
  deliveryId: string;
  storeOrderNumber: string;
  /** `scheduled` offers are not shown to drivers yet; they open 12 hours before the target pickup. */
  status: 'scheduled' | 'open';
  /** `"{cityId}:{capacityClass}"` strings; the rules match them against the driver's claims. */
  audience: string[];
  cityIds: CityId[];
  vehicleClass: VehicleClass;
  vehicleClassRank: number;
  opensAt: TimestampLike;
  openedAt: TimestampLike | null;
  pickup: { storeName: string; areaLabel: string; location: LatLng; readyBy: TimestampLike; ready: boolean };
  dropoff: {
    areaLabel: string;
    /** Rounded to 2 decimals (about 1 km): the exact site is shown only after a claim. */
    approxLocation: LatLng;
  };
  tripKm: number;
  window: { kind: 'asap' | 'scheduled'; startAt: TimestampLike | null; endAt: TimestampLike; label: string };
  load: {
    summary: string;
    pieces: number;
    weightKg: number;
    longestCm: number;
    hasSheets: boolean;
    heavy: boolean;
    /** The first 5 lines. */
    lines: { name: string; quantity: number; unit: SellUnit }[];
  };
  /** The labourer when the order includes one, else the site crew at an attended site, else the driver. */
  unload: 'driver' | 'site_crew' | 'labourer';
  payoutCents: number;
  payoutBreakdown: Omit<DriverPayout, 'offerCents' | 'waitCents' | 'totalCents'>;
  /** Staff were told once that nobody has claimed the job. */
  nudgedAt: TimestampLike | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** A driver holding this many active jobs cannot claim another (`TOO_MANY_JOBS`, §5.5.3). */
export const MAX_ACTIVE_JOBS_PER_DRIVER = 4;

/**
 * One audience entry, `"{cityId}:{capacityClass}"`. A driver's board asks for the offers whose
 * `audience` contains the key of their own claims, and the security rules build the same string (§6.1).
 */
export function audienceKey(cityId: CityId, capacityClass: VehicleClass): string {
  return `${cityId}:${capacityClass}`;
}

/**
 * Who may see an offer (§2.4): every `"{city}:{class}"` for the store's and the jobsite's city, and for
 * each class from the job's own up to the largest the jobsite allows (flatbed when it has no limit).
 *
 * A bigger vehicle may take a smaller job (§3.3 `canCarry`), but never one the site cannot take in: a
 * box truck does not see a job for a lane marked "cargo van max". Entries are listed city by city in
 * the order given, each from the smallest class up. The list is empty when the site's limit is below
 * the job's class: checkout refuses such an order (`jobsite_vehicle_limit`), so no driver should be
 * offered it.
 */
export function audienceFor(
  cityIds: readonly CityId[],
  jobClass: VehicleClass,
  siteMax: VehicleClass | null,
): string[] {
  // One rank table (§3.3): `canCarry` reads it and throws a RangeError for a class outside it, since a
  // guess would offer the job to the wrong vehicles. Both ends are checked even when no class matches.
  canCarry(jobClass, jobClass);
  if (siteMax != null) canCarry(siteMax, siteMax);
  const classes = VEHICLE_CLASS_IDS.filter(
    (capacityClass) =>
      canCarry(capacityClass, jobClass) && (siteMax == null || canCarry(siteMax, capacityClass)),
  );
  // The store and the jobsite are often in the same city: one entry per city is enough.
  const cities = [...new Set(cityIds)];
  return cities.flatMap((cityId) => classes.map((capacityClass) => audienceKey(cityId, capacityClass)));
}
