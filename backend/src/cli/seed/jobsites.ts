/**
 * The jobsites of MARKETPLACE §11.2. Addresses are intersections, never civic numbers; contact phones are
 * in the reserved 555 range.
 */
import type { JobsiteFields } from '@instasupply/shared';

export interface SeedJobsite {
  /** The name scenarios use, e.g. `leslieville`. */
  key: string;
  /** The account key of the owner (accounts.ts). */
  ownerKey: string;
  isDefault: boolean;
  fields: JobsiteFields;
}

export const SEED_JOBSITES: readonly SeedJobsite[] = [
  {
    key: 'leslieville',
    ownerKey: 'dana',
    isDefault: true,
    fields: {
      label: 'Leslieville semi reno',
      line1: 'Pape Ave & Dundas St E',
      line2: null,
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M4M 2E3',
      location: { lat: 43.6648, lng: -79.3405 },
      cityId: 'toronto',
      areaLabel: 'Leslieville · M4M',
      contactName: 'Dana Whitfield',
      contactPhone: '+14165550110',
      instructions: 'Laneway access off Pape. Stack lumber under the tarp by the garage.',
      receiving: 'attended',
      maxVehicleClass: null,
    },
  },
  {
    key: 'junction',
    ownerKey: 'dana',
    isDefault: false,
    fields: {
      label: 'Junction basement',
      line1: 'Dundas St W & Keele St',
      line2: null,
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M6P 1Z2',
      location: { lat: 43.6655, lng: -79.4636 },
      cityId: 'toronto',
      areaLabel: 'The Junction · M6P',
      contactName: 'Luis Ortega',
      contactPhone: '+16475550141',
      instructions: 'Side door code 4410. Drywall inside the side door.',
      receiving: 'unattended',
      maxVehicleClass: 'cargo_van',
    },
  },
  {
    key: 'mimico',
    ownerKey: 'dana',
    isDefault: false,
    fields: {
      label: 'Mimico laneway house',
      line1: 'Royal York Rd & Lake Shore Blvd W',
      line2: null,
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M8V 1L4',
      location: { lat: 43.6163, lng: -79.4955 },
      cityId: 'toronto',
      areaLabel: 'Mimico · M8V',
      contactName: 'Dana Whitfield',
      contactPhone: '+14165550110',
      instructions: 'Lane behind the house; park on the gravel pad.',
      receiving: 'attended',
      maxVehicleClass: null,
    },
  },
  {
    key: 'danforth',
    ownerKey: 'sam',
    isDefault: true,
    fields: {
      label: 'Home — Danforth',
      line1: 'Danforth Ave & Woodbine Ave',
      line2: null,
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M4C 1L9',
      location: { lat: 43.6866, lng: -79.3127 },
      cityId: 'toronto',
      areaLabel: 'Danforth · M4C',
      contactName: 'Sam Okafor',
      contactPhone: '+14375550144',
      instructions: null,
      receiving: 'attended',
      maxVehicleClass: null,
    },
  },
];

/** A jobsite by key; throws for an unknown key. */
export function seedJobsite(key: string): SeedJobsite {
  const jobsite = SEED_JOBSITES.find((candidate) => candidate.key === key);
  if (!jobsite) throw new Error(`unknown seed jobsite ${key}`);
  return jobsite;
}
