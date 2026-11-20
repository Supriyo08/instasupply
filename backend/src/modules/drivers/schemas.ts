/**
 * zod schemas of the driver account requests (docs/PLATFORM.md §5.2, §5.3.2, §6.3.3). The vehicle itself is
 * checked by the shared `validateDriverVehicle` (one validator for the app and the server).
 */
import {
  CITY_IDS,
  VEHICLE_CLASS_IDS,
  type CityId,
  type PayoutAccountPatch,
  type ReviewDriverVehicleRequest,
  type SetDriverStatusRequest,
  type VehicleClass,
} from '@instasupply/shared';
import { z } from 'zod';

const name = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Enter your full name.').max(80));

const optionalReason = (max: number) =>
  z
    .string()
    .max(2000)
    .transform((value) => {
      const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
      return clean === '' ? null : clean;
    })
    .nullable()
    .optional();

const uid = z.string().trim().min(1).max(100);
const cityId = z.enum(CITY_IDS as [CityId, ...CityId[]]);
const vehicleClass = z.enum(VEHICLE_CLASS_IDS as [VehicleClass, ...VehicleClass[]]);
/** Shape-checked by `validateDriverVehicle`. */
const vehicle = z.record(z.string(), z.unknown());

export const RegisterDriverRequestSchema = z
  .object({
    displayName: name,
    cityId,
    vehicle,
    attestations: z
      .object({
        licence: z.literal(true, { message: 'Confirm that you hold a valid licence.' }),
        insurance: z.literal(true, { message: 'Confirm that your vehicle is insured.' }),
        terms: z.literal(true, { message: 'Accept the driver terms.' }),
      })
      .strict(),
  })
  .strict();
export type RegisterDriverBody = z.infer<typeof RegisterDriverRequestSchema>;

export const UpdateDriverVehicleRequestSchema = z.object({ vehicle }).strict();

export const ReviewDriverVehicleRequestSchema = z
  .object({
    uid,
    approve: z.boolean(),
    capacityClass: vehicleClass.nullable().optional(),
    note: optionalReason(300),
  })
  .strict() satisfies z.ZodType<ReviewDriverVehicleRequest>;

export const SetDriverStatusRequestSchema = z
  .object({
    uid,
    status: z.enum(['active', 'suspended']),
    reason: optionalReason(200),
    capacityClass: vehicleClass.nullable().optional(),
    licenceVerified: z.boolean().optional(),
    insuranceVerified: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<SetDriverStatusRequest>;

export const PayoutAccountPatchSchema = z
  .object({
    payoutAccount: z
      .object({
        provider: z.enum(['test', 'stripe']),
        accountRef: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(80),
      })
      .strict()
      .nullable(),
  })
  .strict() satisfies z.ZodType<PayoutAccountPatch>;
