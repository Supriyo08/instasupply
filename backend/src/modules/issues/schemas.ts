/**
 * zod schemas of the issue requests (docs/PLATFORM.md §5.2, §5.3.7; MARKETPLACE §5.5.7). Strict objects. The
 * domain rules of a report (lines of this store order, description, photos) are the shared
 * `validateIssueReport`, run by the command once the store order is loaded.
 */
import {
  isRequestId,
  type AssignPatch,
  type ReportIssueRequest,
  type ResolveIssueRequest,
} from '@instasupply/shared';
import { z } from 'zod';

const requestIdSchema = z
  .string()
  .refine((value) => isRequestId(value), 'Use a UUIDv4 created with api.newRequestId().');
const id = z.string().min(1).max(100);

const issueLines = z
  .array(
    z.object({ lineId: z.string().min(1).max(10), quantity: z.number().int().min(1).max(99_999) }).strict(),
  )
  .max(60);

export const ReportIssueRequestSchema = z
  .object({
    issueId: requestIdSchema,
    storeOrderId: z.string().min(1).max(60),
    type: z.enum(['damaged', 'wrong_item', 'missing_item', 'short_quantity', 'late', 'other']),
    lines: issueLines,
    description: z.string().max(2000),
    photoPaths: z.array(z.string().min(1).max(300)).max(12),
    preferredResolution: z.enum(['replacement', 'refund', 'return']),
  })
  .strict() satisfies z.ZodType<ReportIssueRequest, unknown>;

export const ResolveIssueRequestSchema = z
  .object({
    issueId: requestIdSchema,
    kind: z.enum(['refund', 'replacement', 'no_action']),
    lines: issueLines.min(1).optional(),
    refundDeliveryFee: z.boolean().optional(),
    returnRequired: z.boolean().optional(),
    faultParty: z.enum(['store', 'driver', 'platform', 'customer']).nullable(),
    note: z.string().trim().max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const line of value.lines ?? []) {
      if (seen.has(line.lineId))
        ctx.addIssue({ code: 'custom', path: ['lines'], message: 'List each item once.' });
      seen.add(line.lineId);
    }
  }) satisfies z.ZodType<ResolveIssueRequest, unknown>;

export const AssignPatchSchema = z
  .object({ assignedTo: id.nullable().optional(), status: z.literal('in_review').optional() })
  .strict()
  .refine((value) => value.assignedTo !== undefined || value.status !== undefined, {
    message: 'Send assignedTo or status.',
  }) satisfies z.ZodType<AssignPatch, unknown>;

export const NotesBodySchema = z.object({ notes: z.string().max(5000) }).strict();

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

export const IssuesQuerySchema = z
  .object({
    customerId: id.optional(),
    storeId: z.string().min(1).max(40).optional(),
    orderId: id.optional(),
    storeOrderId: z.string().min(1).max(60).optional(),
    status: list(['open', 'in_review', 'resolved'] as const).optional(),
    sort: z.enum(['createdAt:desc']).default('createdAt:desc'),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
export type IssuesQuery = z.infer<typeof IssuesQuerySchema>;
