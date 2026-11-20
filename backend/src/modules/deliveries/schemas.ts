/**
 * zod schemas of the deliveries module's requests (docs/PLATFORM.md §2.1, §4.1, §5.2, §5.3.5). Strict: an
 * unknown key is an invalid-argument. Free texts are trimmed, whitespace collapsed and cut (the legacy
 * `cleanText`).
 */
import {
  DECLINE_REASONS,
  DELIVERY_STATUSES,
  FAILURE_REASONS,
  MAX_DELIVERIES_PER_IMPORT,
  type AssignDeliveryRequest,
  type CheckInAtStoreRequest,
  type CompleteDeliveryRequest,
  type DeclineReasonId,
  type DeliveryPatch,
  type DeliveryStatus,
  type FailureReasonId,
  type ResolveFailedDeliveryRequest,
  type UpdateDeliveryStatusRequest,
} from '@instasupply/shared';
import { z } from 'zod';
import { pageQuerySchema } from '../../platform/http/pagination';

/** Trimmed, whitespace collapsed, cut to `max`; empty becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .max(10_000)
    .transform((value) => {
      const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
      return clean === '' ? null : clean;
    })
    .nullable()
    .optional();

export const idSchema = z.string().trim().min(1).max(100);

export const latLngSchema = z
  .object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) })
  .strict();

const statusSchema = z.enum(DELIVERY_STATUSES as [DeliveryStatus, ...DeliveryStatus[]]);
const failureReasonSchema = z.enum(
  FAILURE_REASONS.map((reason) => reason.id) as [FailureReasonId, ...FailureReasonId[]],
);
const declineReasonSchema = z.enum(
  DECLINE_REASONS.map((reason) => reason.id) as [DeclineReasonId, ...DeclineReasonId[]],
);

export const UpdateDeliveryStatusRequestSchema = z
  .object({
    deliveryId: idSchema,
    status: statusSchema,
    failureReason: failureReasonSchema.nullable().optional(),
    declineReason: declineReasonSchema.nullable().optional(),
    note: optionalText(500),
    location: latLngSchema.nullable().optional(),
  })
  .strict() satisfies z.ZodType<UpdateDeliveryStatusRequest>;

export const CompleteDeliveryRequestSchema = z
  .object({
    deliveryId: idSchema,
    recipientName: optionalText(80),
    handoffCode: z.string().max(20).nullable().optional(),
    photoPath: z.string().trim().min(1).max(300).nullable().optional(),
    note: optionalText(500),
    location: latLngSchema.nullable().optional(),
  })
  .strict() satisfies z.ZodType<CompleteDeliveryRequest>;

export const CheckInAtStoreRequestSchema = z
  .object({ deliveryId: idSchema, location: latLngSchema.nullable().optional() })
  .strict() satisfies z.ZodType<CheckInAtStoreRequest>;

export const AssignDeliveryRequestSchema = z
  .object({
    deliveryId: idSchema,
    driverId: idSchema.nullable(),
    note: optionalText(300),
    force: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<AssignDeliveryRequest>;

export const ResolveFailedDeliveryRequestSchema = z
  .object({
    storeOrderId: idSchema,
    action: z.enum(['reattempt', 'return_to_store']),
    windowId: z.string().trim().min(1).max(40).nullable().optional(),
    refundDeliveryFee: z.boolean().optional(),
    note: optionalText(500),
  })
  .strict() satisfies z.ZodType<ResolveFailedDeliveryRequest>;

/** Each row is validated with the shared `validateDeliveryInput`, so a bad row is reported, not refused. */
export const CreateDeliveriesRequestSchema = z
  .object({
    deliveries: z
      .array(z.record(z.string(), z.unknown()))
      .min(1, 'Add at least one delivery.')
      .max(
        MAX_DELIVERIES_PER_IMPORT,
        `You can import up to ${MAX_DELIVERIES_PER_IMPORT} deliveries at a time.`,
      ),
  })
  .strict();

const nanpPhone = z
  .string()
  .trim()
  .regex(/^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/, 'Use a +1 phone number.');

/** Exactly the staff-editable keys of MARKETPLACE §6.3. */
export const DeliveryPatchSchema = z
  .object({
    customer: z
      .object({
        name: z.string().trim().min(1).max(120),
        phone: nanpPhone.nullable(),
        email: z.string().trim().email().max(254).nullable().optional(),
      })
      .strict()
      .optional(),
    address: z.string().trim().min(3).max(300).optional(),
    location: latLngSchema.optional(),
    addressNotes: optionalText(500),
    notes: optionalText(500),
    packageCount: z.number().int().min(1).max(999).optional(),
    priority: z.enum(['normal', 'high', 'urgent']).optional(),
    requireCode: z.boolean().optional(),
    windowStart: z.number().int().nonnegative().nullable().optional(),
    windowEnd: z.number().int().nonnegative().nullable().optional(),
    unload: z
      .object({
        status: z.enum(['not_needed', 'needed', 'booked']),
        labourerName: optionalText(80).transform((value) => value ?? null),
        labourerPhone: nanpPhone.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<DeliveryPatch>;

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values as [T, ...T[]])).min(1));

const instant = z.coerce.number().int().nonnegative();

export const DeliveryListQuerySchema = pageQuerySchema
  .extend({
    driverId: idSchema.optional(),
    status: csv(DELIVERY_STATUSES).optional(),
    kind: z.enum(['marketplace', 'manual']).optional(),
    storeId: idSchema.optional(),
    unloadStatus: z.enum(['not_needed', 'needed', 'booked']).optional(),
    offerStatus: csv(['held', 'scheduled', 'open', 'claimed', 'withdrawn'] as const).optional(),
    createdSince: instant.optional(),
    updatedSince: instant.optional(),
    deliveredSince: instant.optional(),
    sort: z.enum(['createdAt:desc', 'updatedAt:desc']).default('createdAt:desc'),
  })
  .strict();

export const DeliveryStatsQuerySchema = z.object({ driverId: idSchema.optional(), since: instant }).strict();

export const EventsQuerySchema = pageQuerySchema.strict();
