/**
 * zod schemas of the commerce requests (docs/PLATFORM.md §5.2, §5.3.5; MARKETPLACE §5.5.1 step 1). Strict
 * objects: an unknown key is `invalid-argument`.
 */
import {
  isNanpPhone,
  isRequestId,
  isWindowId,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  normalizePhone,
  type CancelOrderRequest,
  type PlaceOrderRequest,
  type RegisterCustomerRequest,
} from '@instasupply/shared';
import { z } from 'zod';

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min).max(max));

/** Several lines allowed (site instructions); trimmed, at most `max`. */
const notes = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .transform((value) => (value === '' ? null : value));

export const requestIdSchema = z
  .string()
  .refine((value) => isRequestId(value), 'Use a UUIDv4 created with api.newRequestId().');

const phoneSchema = z
  .string()
  .transform((value) => normalizePhone(value) ?? value)
  .refine((value) => isNanpPhone(value), 'Enter a Canadian or US phone number, like (416) 555-0110.');

const ContactSchema = z.object({ name: cleanText(1, 80), phone: phoneSchema }).strict();

const CartLineSchema = z
  .object({
    productId: z.string().min(1).max(100),
    storeId: z.string().min(1).max(40),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  })
  .strict();

export const PlaceOrderRequestSchema = z
  .object({
    checkoutId: requestIdSchema,
    items: z.array(CartLineSchema).min(1, 'Your cart is empty.').max(MAX_CART_LINES),
    fulfilment: z.enum(['delivery', 'pickup']),
    jobsiteId: z.string().min(1).max(100).nullable(),
    windowId: z
      .string()
      .refine((value) => isWindowId(value), 'Choose a delivery time.')
      .nullable(),
    receiving: z.enum(['attended', 'unattended']).nullable(),
    siteContact: ContactSchema.nullable(),
    instructions: notes(500).nullable(),
    unloadHelpStoreIds: z.array(z.string().min(1).max(40)).max(5),
    cardId: z.string().min(1).max(100),
    promoCode: z.string().trim().max(20).nullable(),
    expectedTotalCents: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fulfilment === 'delivery') {
      if (value.jobsiteId === null) {
        ctx.addIssue({ code: 'custom', path: ['jobsiteId'], message: 'Choose a jobsite for the delivery.' });
      }
      if (value.windowId === null) {
        ctx.addIssue({ code: 'custom', path: ['windowId'], message: 'Choose a delivery time.' });
      }
    }
    const stores = new Set(value.items.map((item) => item.storeId));
    if (value.unloadHelpStoreIds.some((storeId) => !stores.has(storeId))) {
      ctx.addIssue({
        code: 'custom',
        path: ['unloadHelpStoreIds'],
        message: 'Labourer help can only be asked for stores in the cart.',
      });
    }
    const storeOf = new Map<string, string>();
    let merged = 0;
    const quantities = new Map<string, number>();
    for (const item of value.items) {
      const known = storeOf.get(item.productId);
      if (known !== undefined && known !== item.storeId) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: 'A product appears with two different stores.',
        });
      }
      storeOf.set(item.productId, item.storeId);
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
      merged = quantities.size;
    }
    if (merged > MAX_CART_LINES)
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Too many lines.' });
    if ([...quantities.values()].some((quantity) => quantity > MAX_LINE_QUANTITY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: `At most ${MAX_LINE_QUANTITY} of each product.`,
      });
    }
  }) satisfies z.ZodType<PlaceOrderRequest, unknown>;

export const CancelOrderRequestSchema = z
  .object({
    orderId: requestIdSchema,
    storeOrderIds: z.array(z.string().min(1).max(60)).max(5).nullable().optional(),
    reason: notes(300).nullable().optional(),
  })
  .strict() satisfies z.ZodType<CancelOrderRequest, unknown>;

export const RegisterCustomerRequestSchema = z
  .object({
    displayName: cleanText(1, 80),
    companyName: z
      .string()
      .transform((value) => value.trim().replace(/\s+/g, ' '))
      .pipe(z.string().max(80))
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    accountType: z.enum(['contractor', 'renovator', 'builder', 'homeowner']).nullable().optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<RegisterCustomerRequest, unknown>;

const list = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    )
    .pipe(z.array(z.enum(values)).min(1));

const ORDER_STATUSES = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
  'cancelled',
] as const;
const PAYMENT_STATUSES = [
  'authorized',
  'capture_pending',
  'captured',
  'capture_failed',
  'partially_refunded',
  'refunded',
  'voided',
  'not_required',
] as const;

export const OrdersQuerySchema = z
  .object({
    customerId: z.string().min(1).max(100).optional(),
    status: list(ORDER_STATUSES).optional(),
    jobsiteId: z.string().min(1).max(100).optional(),
    storeId: z.string().min(1).max(40).optional(),
    needsAttention: z.enum(['true']).optional(),
    paymentStatus: list(PAYMENT_STATUSES).optional(),
    createdSince: z.coerce.number().int().min(0).optional(),
    createdUntil: z.coerce.number().int().min(0).optional(),
    sort: z.enum(['createdAt:desc']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;
