/**
 * `suggestStore` (docs/PLATFORM.md §5.2, MARKETPLACE §5.4): public. Store name 2–80, city 2–60, interests from
 * `SUGGEST_STORE_INTERESTS` (no repeats), an optional email. The `suggest` limit (5 per hour per uid, or per
 * address for guests) is consumed first. `source` is `app` when the `X-Client` name is `customer` or `driver`,
 * else `web`. Staff get a silent `store_suggestion` (key `suggestion-{id}`). Suggestions are created only here:
 * there is no REST create.
 */
import { SUGGEST_STORE_INTERESTS, type OkResponse, type SuggestStoreRequest } from '@instasupply/shared';
import { z } from 'zod';
import { publicPolicy } from '../../platform/auth/policies';
import { hmacHex } from '../../platform/crypto';
import { withTransaction } from '../../platform/db/tx';
import { defineCommand } from '../../platform/http/command';
import { parseClientHeader, type RequestContext } from '../../platform/http/context';
import { use } from '../../platform/http/rate-limit';
import { newId } from '../../platform/ids';
import { notifyStaff } from '../notifications/notify';
import { insertSuggestion } from './repository';

const text = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

const INTERESTS = new Set(SUGGEST_STORE_INTERESTS);

export const SuggestStoreRequestSchema = z
  .object({
    storeName: text(2, 80),
    city: text(2, 60),
    interests: z
      .array(z.string().refine((value) => INTERESTS.has(value), 'Pick from the listed interests.'))
      .max(SUGGEST_STORE_INTERESTS.length)
      .refine((values) => new Set(values).size === values.length, 'An interest is listed twice.'),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable(),
  })
  .strict() satisfies z.ZodType<SuggestStoreRequest, unknown>;

/** The subject of the `suggest` limit: the uid, or an HMAC of the address for guests (§4.6). */
const suggestSubject = (ctx: RequestContext): string => ctx.actor?.uid ?? hmacHex('ip', ctx.ip);

export function sourceOf(client: string | null): 'app' | 'web' {
  const name = parseClientHeader(client).name;
  return name === 'customer' || name === 'driver' ? 'app' : 'web';
}

export function registerSuggestStore(): void {
  defineCommand<SuggestStoreRequest, OkResponse>({
    name: 'suggestStore',
    policy: publicPolicy,
    schema: SuggestStoreRequestSchema,
    limits: (ctx) => [use('suggest', suggestSubject(ctx))],
    handler: async (ctx, req, actor) => {
      const id = newId();
      const now = ctx.deps.clock.now();
      await withTransaction(ctx.deps, async (tx) => {
        await insertSuggestion(tx, {
          id,
          storeName: req.storeName,
          city: req.city,
          interests: req.interests,
          email: req.email,
          suggestedBy: actor?.uid ?? null,
          source: sourceOf(ctx.client),
          status: 'new',
          createdAt: now,
          updatedAt: now,
        });
        await notifyStaff(tx, {
          type: 'store_suggestion',
          title: 'Store suggestion',
          body: `${req.storeName} in ${req.city}`,
          silent: true,
          key: `suggestion-${id}`,
        });
      });
      return { ok: true };
    },
  });
}
