/** Request schemas of the store-order commands and REST endpoints (docs/PLATFORM.md §5.2, §5.3.5). */
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  STORE_ORDER_STATUSES,
  type AcceptStoreOrderRequest,
  type CompletePickupRequest,
  type LineAdjustment,
  type RejectStoreOrderRequest,
  type ShortReason,
  type StoreOrderStatus,
  type StoreRejectReason,
  type UpdateStoreOrderStatusRequest,
} from '@instasupply/shared';
import { z } from 'zod';
import { MAX_LIMIT } from '../../platform/http/pagination';

const SHORT_REASONS = [
  'out_of_stock',
  'damaged',
  'discontinued',
  'other',
] as const satisfies readonly ShortReason[];
const REJECT_REASONS = [
  'out_of_stock',
  'cannot_meet_time',
  'store_closed',
  'pricing_error',
  'cannot_deliver_to_site',
  'no_response',
  'other',
] as const satisfies readonly StoreRejectReason[];

const storeOrderId = z.string().min(3).max(100);
const version = z.number().int().min(0).max(1_000_000);
const note = z.string().trim().max(500).nullable().optional();

export const LineAdjustmentSchema = z
  .object({
    lineId: z.string().min(1).max(20),
    fulfilledQty: z.number().int().min(0).max(MAX_LINE_QUANTITY),
    reason: z.enum(SHORT_REASONS),
  })
  .strict() satisfies z.ZodType<LineAdjustment>;

const adjustments = z.array(LineAdjustmentSchema).max(MAX_CART_LINES).optional();

export const AcceptStoreOrderRequestSchema = z
  .object({ storeOrderId, expectedVersion: version, adjustments, note })
  .strict() satisfies z.ZodType<AcceptStoreOrderRequest>;

export const UpdateStoreOrderStatusRequestSchema = z
  .object({
    storeOrderId,
    expectedVersion: version,
    status: z.enum(['preparing', 'ready']),
    adjustments,
    note,
  })
  .strict() satisfies z.ZodType<UpdateStoreOrderStatusRequest>;

/** `no_response` is the schedule's reason, never a person's. */
export const RejectStoreOrderRequestSchema = z
  .object({
    storeOrderId,
    expectedVersion: version,
    reason: z
      .enum(REJECT_REASONS)
      .refine((reason) => reason !== 'no_response', 'not a reason a store can give'),
    note,
  })
  .strict() satisfies z.ZodType<RejectStoreOrderRequest>;

export const CompletePickupRequestSchema = z
  .object({
    storeOrderId,
    expectedVersion: version,
    pickupCode: z
      .string()
      .regex(/^\d{4}$/, '4 digits')
      .nullable(),
    adjustments,
    overrideReason: z.string().trim().min(3).max(300).nullable().optional(),
  })
  .strict() satisfies z.ZodType<CompletePickupRequest>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const epochMs = z.coerce.number().int().min(0);
const statusList = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    for (const part of parts) {
      if (!(STORE_ORDER_STATUSES as readonly string[]).includes(part)) {
        ctx.addIssue({ code: 'custom', message: `unknown status ${part}` });
        return z.NEVER;
      }
    }
    return parts as StoreOrderStatus[];
  });

export const StoreOrderListQuerySchema = z
  .object({
    orderId: z.string().min(1).max(100).optional(),
    storeId: z.string().min(1).max(40).optional(),
    customerId: z.string().min(1).max(100).optional(),
    status: statusList.optional(),
    acceptOverdue: z.enum(['true']).optional(),
    readyByDate: isoDate.optional(),
    readyByDateAfter: isoDate.optional(),
    completedSince: epochMs.optional(),
    createdSince: epochMs.optional(),
    sort: z.enum(['createdAt:desc', 'readyBy:asc', 'completedAt:desc']).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
export type StoreOrderListQuery = z.infer<typeof StoreOrderListQuerySchema>;

export const StoreOrderParamsSchema = z.object({ storeOrderId: z.string().min(1).max(100) }).strict();
