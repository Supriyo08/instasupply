/**
 * zod schemas of the quote requests (docs/PLATFORM.md §5.2, §5.3.7; MARKETPLACE §5.5.6). Strict objects: an
 * unknown key is `invalid-argument`. The domain rules of a material list (lengths, contact, jobsite) are the
 * shared `validateMaterialList`, run by the command after the shape is known.
 */
import {
  isNanpPhone,
  isRequestId,
  isWindowId,
  normalizePhone,
  SELL_UNITS,
  type AcceptQuoteRequest,
  type AssignPatch,
  type CloseQuoteRequest,
  type ReopenQuoteRequest,
  type SellUnit,
  type SendQuoteRequest,
  type SubmitMaterialListRequest,
} from '@instasupply/shared';
import { z } from 'zod';

export const requestIdSchema = z
  .string()
  .refine((value) => isRequestId(value), 'Use a UUIDv4 created with api.newRequestId().');

const id = z.string().min(1).max(100);
const storeId = z.string().min(1).max(40);
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => (value.trim() === '' ? null : value.trim()))
    .nullable();

const windowIdSchema = z.string().refine((value) => isWindowId(value), 'Choose a delivery time.');
const fulfilment = z.enum(['delivery', 'pickup']);
const receiving = z.enum(['attended', 'unattended']);
const sellUnit = z
  .string()
  .refine((value): value is SellUnit => (SELL_UNITS as readonly string[]).includes(value));

export const SubmitMaterialListRequestSchema = z
  .object({
    requestId: requestIdSchema,
    lines: z
      .array(z.object({ text: z.string().max(500), quantity: z.number().nullable() }).strict())
      .max(200),
    attachments: z
      .array(
        z
          .object({
            path: z.string().min(1).max(300),
            name: z.string().max(300),
            contentType: z.string().max(200),
            sizeBytes: z.number(),
          })
          .strict(),
      )
      .max(10),
    neededBy: z
      .object({ kind: z.enum(['asap', 'this_week', 'date']), date: z.string().max(10).nullable() })
      .strict(),
    fulfilment,
    jobsiteId: id.nullable(),
    contact: z
      .object({
        preferred: z.enum(['call', 'whatsapp', 'email']),
        phone: z.string().max(40).nullable(),
        email: z.string().max(254).nullable(),
      })
      .strict(),
    notes: z.string().max(2000).nullable(),
  })
  .strict() satisfies z.ZodType<SubmitMaterialListRequest, unknown>;

const dims = z
  .object({
    l: z.number().positive().max(2000),
    w: z.number().positive().max(2000),
    h: z.number().positive().max(2000),
  })
  .strict();

const requestLine = z.number().int().min(0).max(59).nullable();

const CatalogQuoteLineSchema = z
  .object({
    kind: z.literal('catalog'),
    productId: id,
    quantity: z.number().int().min(1).max(9_999),
    unitPriceCents: z.number().int().min(1).max(10_000_000).nullable(),
    note: nullableText(300),
    requestLine,
  })
  .strict();

const CustomQuoteLineSchema = z
  .object({
    kind: z.literal('custom'),
    storeId,
    name: z
      .string()
      .transform((value) => value.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(2).max(120)),
    unit: sellUnit,
    size: nullableText(80),
    quantity: z.number().int().min(1).max(9_999),
    unitPriceCents: z.number().int().min(1).max(10_000_000),
    weightKg: z.number().positive().max(10_000),
    dimsCm: dims,
    note: nullableText(300),
    requestLine,
  })
  .strict();

export const SendQuoteRequestSchema = z
  .object({
    quoteId: requestIdSchema,
    expectedVersion: z.number().int().min(0),
    lines: z
      .array(z.discriminatedUnion('kind', [CatalogQuoteLineSchema, CustomQuoteLineSchema]))
      .min(1, 'Add at least one line to the quote.')
      .max(100),
    unmatched: z
      .array(
        z
          .object({
            requestLine: z.number().int().min(0).max(59),
            text: z.string().max(200),
            reason: z.string().max(300),
          })
          .strict(),
      )
      .max(60),
    fulfilment,
    receiving: receiving.nullable(),
    windowId: windowIdSchema.nullable(),
    unloadHelpStoreIds: z.array(storeId).max(5),
    message: nullableText(1000),
    validHours: z.union([z.literal(24), z.literal(48), z.literal(72)]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const products = new Set<string>();
    for (const line of value.lines) {
      if (line.kind !== 'catalog') continue;
      if (products.has(line.productId)) {
        ctx.addIssue({ code: 'custom', path: ['lines'], message: 'List each product once.' });
      }
      products.add(line.productId);
    }
  }) satisfies z.ZodType<SendQuoteRequest, unknown>;

const phoneSchema = z
  .string()
  .max(40)
  .transform((value) => normalizePhone(value) ?? value)
  .refine((value) => isNanpPhone(value), 'Enter a Canadian or US phone number, like (416) 555-0110.');

const ContactSchema = z.object({ name: z.string().trim().min(1).max(80), phone: phoneSchema }).strict();

export const AcceptQuoteRequestSchema = z
  .object({
    quoteId: requestIdSchema,
    version: z.number().int().min(1),
    checkoutId: requestIdSchema,
    cardId: id,
    windowId: windowIdSchema.nullable(),
    receiving: receiving.nullable(),
    siteContact: ContactSchema.nullable(),
    instructions: nullableText(500),
    unloadHelpStoreIds: z.array(storeId).max(5).optional(),
    expectedTotalCents: z.number().int().min(0),
  })
  .strict() satisfies z.ZodType<AcceptQuoteRequest, unknown>;

export const CloseQuoteRequestSchema = z
  .object({ quoteId: requestIdSchema, reason: nullableText(300).optional() })
  .strict() satisfies z.ZodType<CloseQuoteRequest, unknown>;

export const ReopenQuoteRequestSchema = z
  .object({ quoteId: requestIdSchema, message: nullableText(1000) })
  .strict() satisfies z.ZodType<ReopenQuoteRequest, unknown>;

export const AssignPatchSchema = z
  .object({ assignedTo: id.nullable().optional(), status: z.literal('in_review').optional() })
  .strict()
  .refine((value) => value.assignedTo !== undefined || value.status !== undefined, {
    message: 'Send assignedTo or status.',
  }) satisfies z.ZodType<AssignPatch, unknown>;

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

export const QuotesQuerySchema = z
  .object({
    customerId: id.optional(),
    status: list([
      'submitted',
      'in_review',
      'quoted',
      'accepted',
      'declined',
      'expired',
      'cancelled',
    ] as const).optional(),
    assignedTo: id.optional(),
    sort: z.enum(['createdAt:desc', 'respondBy:asc']).default('createdAt:desc'),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
export type QuotesQuery = z.infer<typeof QuotesQuerySchema>;

/** The builder draft: any JSON object (≤ 200 KiB, checked on the raw body). */
export const WorkspaceSchema = z.record(z.string(), z.unknown());
export const WORKSPACE_MAX_BYTES = 200 * 1024;
