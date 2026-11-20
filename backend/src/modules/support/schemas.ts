/** zod schemas of the support requests (docs/PLATFORM.md §5.3.6, §5.4). */
import type { SupportMessageInput, SupportThreadPatch } from '@instasupply/shared';
import { z } from 'zod';
import { pageQuerySchema } from '../../platform/http/pagination';
import { idParam } from '../../platform/http/route';
import { isRequestId } from '../../platform/ids';

/** Trim and collapse whitespace inside, like the legacy `cleanText`. */
const text = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[^\S\n]+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

export const messageId = z
  .string()
  .refine((value) => isRequestId(value), 'Use a UUIDv4 created with api.newRequestId().');

export const SupportContextSchema = z
  .object({
    kind: z.enum(['order', 'store_order', 'quote', 'issue']),
    id: text(1, 80),
    label: text(1, 80),
  })
  .strict();

export const SupportMessageInputSchema = z
  .object({
    id: messageId,
    text: text(1, 1000),
    context: SupportContextSchema.nullable(),
  })
  .strict() satisfies z.ZodType<SupportMessageInput, unknown>;

export const SupportThreadPatchSchema = z
  .object({
    status: z.enum(['open', 'resolved']).optional(),
    assignedTo: idParam.nullable().optional(),
  })
  .strict() satisfies z.ZodType<SupportThreadPatch, unknown>;

export const ThreadListQuerySchema = pageQuerySchema
  .extend({
    kind: z.enum(['customer', 'store']).optional(),
    status: z.enum(['open', 'resolved']).optional(),
    unread: z.enum(['true', 'false']).optional(),
    sort: z.enum(['updatedAt:desc']).optional(),
  })
  .strict();

/** Message lists default to 100 (§5.3.6). */
export const MessageListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();

export const threadParams = z.object({ threadId: idParam });
