import {
  CITIES,
  nearestCity,
  type CityId,
  type GeocodeAddressResponse,
  type LatLng,
} from '@instasupply/shared';

/** What the site sheet knows about a chosen point, enough to save it as a jobsite. */
export interface PlaceDetails {
  location: LatLng;
  label: string;
  line1: string | null;
  city: string;
  postalCode: string | null;
  cityId: CityId;
  areaLabel: string;
  source: 'gps' | 'pin' | 'search';
}

export type GeocodeResult = GeocodeAddressResponse['results'][number];

export function fromGeocode(result: GeocodeResult): PlaceDetails {
  return {
    location: result.location,
    label: result.label,
    line1: result.line1,
    city: result.city ?? CITIES[result.cityId].name,
    postalCode: result.postalCode,
    cityId: result.cityId,
    areaLabel: result.areaLabel,
    source: 'search',
  };
}

/** A GPS fix or a dropped pin: no street address, the nearest of the 15 cities (MARKETPLACE §7.3). */
export function fromPoint(location: LatLng, source: 'gps' | 'pin'): PlaceDetails {
  const cityId = nearestCity(location);
  const city = CITIES[cityId].name;
  return {
    location,
    label: source === 'gps' ? 'Current location' : 'Dropped pin',
    line1: null,
    city,
    postalCode: null,
    cityId,
    areaLabel: city,
    source,
  };
}
