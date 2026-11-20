import {
  CITIES,
  formatDayET,
  nearestCity,
  r6,
  validateJobsite,
  type CityId,
  type GeocodeAddressResponse,
  type Jobsite,
  type JobsiteFields,
  type LatLng,
  type Receiving,
  type UserProfile,
  type ValidationResult,
  type VehicleClass,
} from '@instasupply/shared';

import { toNationalInput } from '@/features/session/components/phone';

export type GeocodeResult = GeocodeAddressResponse['results'][number];

/** The editor's form state: text as typed, the pin, and where the city came from. */
export interface JobsiteDraft {
  id: string | null;
  label: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  location: LatLng | null;
  cityId: CityId | null;
  areaLabel: string;
  contactName: string;
  contactPhone: string;
  instructions: string;
  receiving: Receiving;
  maxVehicleClass: VehicleClass | null;
  isDefault: boolean;
  /** `geocode`: the city and area came from the address search and win over the pin's nearest city. */
  placeSource: 'geocode' | 'pin' | null;
}

export type JobsiteErrors = Partial<Record<keyof JobsiteFields | 'form', string>>;

/** "Narrow lane: cargo van max" choices; null is no limit. */
export const VEHICLE_LIMITS: readonly { value: VehicleClass | null; label: string }[] = [
  { value: null, label: 'No limit' },
  { value: 'car', label: 'Car' },
  { value: 'suv', label: 'SUV' },
  { value: 'pickup', label: 'Pickup truck' },
  { value: 'cargo_van', label: 'Cargo van' },
  { value: 'box_truck', label: 'Box truck' },
];

export function draftFrom(
  jobsite: Jobsite | null,
  profile: UserProfile | null,
  firstSite: boolean,
): JobsiteDraft {
  if (jobsite) {
    return {
      id: jobsite.id,
      label: jobsite.label,
      line1: jobsite.line1,
      line2: jobsite.line2 ?? '',
      city: jobsite.city,
      postalCode: jobsite.postalCode ?? '',
      location: jobsite.location,
      cityId: jobsite.cityId,
      areaLabel: jobsite.areaLabel,
      contactName: jobsite.contactName,
      contactPhone: toNationalInput(jobsite.contactPhone),
      instructions: jobsite.instructions ?? '',
      receiving: jobsite.receiving,
      maxVehicleClass: jobsite.maxVehicleClass,
      isDefault: jobsite.isDefault,
      placeSource: 'geocode',
    };
  }
  return {
    id: null,
    label: '',
    line1: '',
    line2: '',
    city: '',
    postalCode: '',
    location: null,
    cityId: null,
    areaLabel: '',
    contactName: profile?.displayName ?? '',
    contactPhone: toNationalInput(profile?.phoneNumber ?? null),
    instructions: '',
    receiving: 'attended',
    maxVehicleClass: null,
    isDefault: firstSite,
    placeSource: null,
  };
}

/** Fills line 1, city, postal code, city id, area and the pin from an address search result. */
export function withGeocode(draft: JobsiteDraft, result: GeocodeResult): JobsiteDraft {
  return {
    ...draft,
    line1: result.line1 ?? draft.line1,
    city: result.city ?? CITIES[result.cityId].name,
    postalCode: result.postalCode ?? '',
    cityId: result.cityId,
    areaLabel: result.areaLabel,
    location: r6(result.location),
    placeSource: 'geocode',
  };
}

/**
 * A dropped or dragged pin. A new build may only have a pin: the city is the pin's nearest city and
 * the area is that city's name, unless an address search already named them.
 */
export function withPin(draft: JobsiteDraft, point: LatLng): JobsiteDraft {
  const location = r6(point);
  if (draft.placeSource === 'geocode' && draft.cityId) return { ...draft, location };
  const cityId = nearestCity(location);
  const name = CITIES[cityId].name;
  return { ...draft, location, cityId, city: name, areaLabel: name, placeSource: 'pin' };
}

/** The draft checked by the shared `validateJobsite`, exactly as the server checks it. */
export function checkDraft(draft: JobsiteDraft): ValidationResult<JobsiteFields> {
  return validateJobsite({
    label: draft.label,
    line1: draft.line1,
    line2: draft.line2.trim() ? draft.line2 : null,
    city: draft.city,
    province: 'ON',
    postalCode: draft.postalCode.trim() ? draft.postalCode : null,
    location: draft.location,
    cityId: draft.cityId,
    areaLabel: draft.areaLabel,
    contactName: draft.contactName,
    contactPhone: draft.contactPhone,
    instructions: draft.instructions.trim() ? draft.instructions : null,
    receiving: draft.receiving,
    maxVehicleClass: draft.maxVehicleClass,
  });
}

/** "12 Carlaw Ave, Unit 3, Toronto, M4M 2R7". */
export function jobsiteAddress(jobsite: Pick<Jobsite, 'line1' | 'line2' | 'city' | 'postalCode'>): string {
  return [jobsite.line1, jobsite.line2, jobsite.city, jobsite.postalCode].filter(Boolean).join(', ');
}

/** "Last used Nov 12" for the list, or null. */
export function lastUsedLabel(jobsite: Jobsite, now: number): string | null {
  return jobsite.lastUsedAt ? `Last used ${formatDayET(jobsite.lastUsedAt, now)}` : null;
}
