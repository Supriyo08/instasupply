/**
 * The one market InstaSupply serves (§1.1, §1.5): the Greater Toronto Area. Its currency, tax, time
 * zone, the 15 cities that stores and drivers belong to, the area jobsites must be in, and the dates
 * on which nothing is delivered or picked up.
 */
import type { DayHours, Weekday } from './catalog';
import { haversineMeters, isValidLatLng } from './geo';
import type { LatLng } from './types';

export const MARKET_ID = 'gta' as const;
export type MarketId = typeof MARKET_ID;

/** Every business date (`YYYY-MM-DD`) and clock time (`HH:MM`) is in this zone (§1.1). */
export const MARKET_TIME_ZONE = 'America/Toronto';

export const CURRENCY = 'CAD' as const;

/** Ontario HST, 13 %. Charged per store order: `percentBps(taxable, TAX.rateBps)` (§3.1 rule 8). */
export const TAX = { label: 'HST', rateBps: 1300 } as const;

/** Drivers see jobs in their own city, so every store, jobsite and driver carries one of these (D9). */
export type CityId =
  | 'toronto'
  | 'mississauga'
  | 'brampton'
  | 'vaughan'
  | 'markham'
  | 'richmond_hill'
  | 'oakville'
  | 'burlington'
  | 'milton'
  | 'pickering'
  | 'ajax'
  | 'whitby'
  | 'oshawa'
  | 'newmarket'
  | 'aurora';

/**
 * City centres for `nearestCity` (§1.5). Toronto also has three anchors: with its centre alone, a pin
 * in Scarborough lands in Markham, one in North York in Vaughan and one in north Etobicoke in
 * Mississauga.
 */
export const CITIES: Record<CityId, { name: string; center: LatLng; anchors: LatLng[] }> = {
  toronto: {
    name: 'Toronto',
    center: { lat: 43.6532, lng: -79.3832 },
    anchors: [
      { lat: 43.7615, lng: -79.4111 }, // North York
      { lat: 43.7731, lng: -79.2577 }, // Scarborough
      { lat: 43.66, lng: -79.53 }, // Etobicoke
    ],
  },
  mississauga: { name: 'Mississauga', center: { lat: 43.589, lng: -79.6441 }, anchors: [] },
  brampton: { name: 'Brampton', center: { lat: 43.7315, lng: -79.7624 }, anchors: [] },
  vaughan: { name: 'Vaughan', center: { lat: 43.8361, lng: -79.4983 }, anchors: [] },
  markham: { name: 'Markham', center: { lat: 43.8561, lng: -79.337 }, anchors: [] },
  richmond_hill: { name: 'Richmond Hill', center: { lat: 43.8828, lng: -79.4403 }, anchors: [] },
  oakville: { name: 'Oakville', center: { lat: 43.4675, lng: -79.6877 }, anchors: [] },
  burlington: { name: 'Burlington', center: { lat: 43.3255, lng: -79.799 }, anchors: [] },
  milton: { name: 'Milton', center: { lat: 43.5183, lng: -79.8774 }, anchors: [] },
  pickering: { name: 'Pickering', center: { lat: 43.8384, lng: -79.0868 }, anchors: [] },
  ajax: { name: 'Ajax', center: { lat: 43.8509, lng: -79.0204 }, anchors: [] },
  whitby: { name: 'Whitby', center: { lat: 43.8975, lng: -78.9429 }, anchors: [] },
  oshawa: { name: 'Oshawa', center: { lat: 43.8971, lng: -78.8658 }, anchors: [] },
  newmarket: { name: 'Newmarket', center: { lat: 44.0592, lng: -79.4613 }, anchors: [] },
  aurora: { name: 'Aurora', center: { lat: 44.0065, lng: -79.4504 }, anchors: [] },
};

/** The 15 city ids, in the order of §1.5. The security rules repeat this list (§6.1). */
export const CITY_IDS: readonly CityId[] = Object.keys(CITIES) as CityId[];

/**
 * A jobsite pin must be inside this box, otherwise checkout fails with `OUTSIDE_SERVICE_AREA` (§5.5.1).
 * The security rules check the same four numbers (§6.1).
 */
export const SERVICE_AREA = { south: 43.25, west: -80.0, north: 44.15, east: -78.75 };

/**
 * Ontario statutory holidays and their days in lieu for 2026 and 2027, as Toronto dates (§4.2). No
 * store delivers or hands over a pickup on these dates, whatever its own hours say.
 */
export const ONTARIO_HOLIDAYS: readonly string[] = [
  '2026-01-01',
  '2026-02-16',
  '2026-04-03',
  '2026-05-18',
  '2026-07-01',
  '2026-08-03',
  '2026-09-07',
  '2026-10-12',
  '2026-12-25',
  '2026-12-26',
  '2026-12-28',
  '2027-01-01',
  '2027-02-15',
  '2027-03-26',
  '2027-05-24',
  '2027-07-01',
  '2027-08-02',
  '2027-09-06',
  '2027-10-11',
  '2027-12-25',
  '2027-12-26',
  '2027-12-27',
  '2027-12-28',
];

/**
 * When InstaSupply staff answer, in Toronto time. The 30-minute quote promise counts from the next
 * opening when a material list arrives outside these hours (§4.6 `QUOTE_SLA_MIN`).
 */
export const SUPPORT_HOURS: Record<Weekday, DayHours | null> = {
  mon: { open: '07:00', close: '18:00' },
  tue: { open: '07:00', close: '18:00' },
  wed: { open: '07:00', close: '18:00' },
  thu: { open: '07:00', close: '18:00' },
  fri: { open: '07:00', close: '18:00' },
  sat: { open: '08:00', close: '14:00' },
  sun: null,
};

/**
 * True for a point inside `SERVICE_AREA`, its edges included, exactly as the security rules test a
 * jobsite pin (§6.1 `inServiceArea`). False for anything that is not a valid point.
 */
export function isInServiceArea(point: LatLng): boolean {
  return (
    isValidLatLng(point) &&
    point.lat >= SERVICE_AREA.south &&
    point.lat <= SERVICE_AREA.north &&
    point.lng >= SERVICE_AREA.west &&
    point.lng <= SERVICE_AREA.east
  );
}

/**
 * The city of a dropped pin: the one whose centre or anchor is nearest (§1.5). It is approximate near
 * city borders, so a municipality returned by `geocodeAddress` wins over it.
 *
 * It answers for any valid point, also one outside `SERVICE_AREA`; whether we deliver there is a
 * separate question (`isInServiceArea`). A point without a usable latitude and longitude throws.
 */
export function nearestCity(point: LatLng): CityId {
  // The spec is silent on a broken pin. No city is "nearest" to it, and filing it under one anyway
  // would show the job to the wrong drivers, so it is refused like `roadTenths` refuses it.
  if (!isValidLatLng(point)) {
    throw new RangeError('nearestCity: the point needs a valid latitude and longitude');
  }
  let nearest: CityId = 'toronto';
  let nearestMeters = haversineMeters(point, CITIES.toronto.center);
  for (const cityId of CITY_IDS) {
    const city = CITIES[cityId];
    for (const place of [city.center, ...city.anchors]) {
      const meters = haversineMeters(point, place);
      // Only a strictly nearer place takes over, so an exact tie stays with the city listed first in §1.5.
      if (meters < nearestMeters) {
        nearest = cityId;
        nearestMeters = meters;
      }
    }
  }
  return nearest;
}
