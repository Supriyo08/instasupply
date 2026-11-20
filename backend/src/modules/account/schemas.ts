/**
 * zod schemas of the caller's own data (docs/PLATFORM.md §5.3.3, §5.4). Every object is strict: an unknown key
 * (a client-set `lastUsedAt`, a card `number` or `cvv`) is `invalid-argument`. The domain checks are the shared
 * validators (`validateJobsite`), so the apps and the server judge a jobsite the same way.
 */
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  validateJobsite,
  type CardInput,
  type CartInput,
  type JobsiteFields,
  type JobsiteInput,
  type ProfilePatch,
} from '@instasupply/shared';
import { z } from 'zod';

/** Trimmed, whitespace collapsed, `min`–`max` characters. */
const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min).max(max));

const ACCOUNT_TYPES = ['contractor', 'renovator', 'builder', 'homeowner'] as const;
const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'card'] as const;

/** The six boolean keys of UserPreferences, nothing else. */
const PreferencesSchema = z
  .object({
    chatPush: z.boolean().optional(),
    deliveryPush: z.boolean().optional(),
    orderPush: z.boolean().optional(),
    promoPush: z.boolean().optional(),
    jobPush: z.boolean().optional(),
    storeOrderPush: z.boolean().optional(),
  })
  .strict();

export const ProfilePatchSchema = z
  .object({
    displayName: cleanText(1, 80).optional(),
    photoPath: z.string().min(1).max(500).nullable().optional(),
    preferences: PreferencesSchema.optional(),
    companyName: cleanText(1, 80).nullable().optional(),
    accountType: z.enum(ACCOUNT_TYPES).nullable().optional(),
  })
  .strict() satisfies z.ZodType<ProfilePatch>;

/** The keys of JobsiteFields: the shared validator judges their values. */
const JOBSITE_FIELD_KEYS = [
  'label',
  'line1',
  'line2',
  'city',
  'province',
  'postalCode',
  'location',
  'cityId',
  'areaLabel',
  'contactName',
  'contactPhone',
  'instructions',
  'receiving',
  'maxVehicleClass',
] as const satisfies readonly (keyof JobsiteFields)[];

const jobsiteShape = Object.fromEntries(JOBSITE_FIELD_KEYS.map((key) => [key, z.unknown()])) as Record<
  (typeof JOBSITE_FIELD_KEYS)[number],
  z.ZodUnknown
>;

export const JobsiteInputSchema = z
  .object({ ...jobsiteShape, id: z.string().optional(), isDefault: z.boolean() })
  .strict()
  .transform((raw, ctx): JobsiteInput => {
    const { id, isDefault, ...fields } = raw;
    const result = validateJobsite(fields);
    if (!result.ok) {
      for (const [path, message] of Object.entries(result.errors)) {
        ctx.addIssue({ code: 'custom', path: path === 'form' ? [] : [path], message: String(message) });
      }
      return z.NEVER;
    }
    return { ...result.value, ...(id === undefined ? {} : { id }), isDefault };
  }) satisfies z.ZodType<JobsiteInput, unknown>;

export const CardInputSchema = z
  .object({
    id: z.string().optional(),
    brand: z.enum(CARD_BRANDS),
    last4: z.string().regex(/^[0-9]{4}$/, 'Enter the last 4 digits of the card.'),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2024).max(2100),
    holder: cleanText(1, 80),
    isDefault: z.boolean(),
  })
  .strict() satisfies z.ZodType<CardInput, unknown>;

const CartLineSchema = z
  .object({
    productId: z.string().min(1).max(100),
    storeId: z.string().min(1).max(40),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  })
  .strict();

export const CartInputSchema = z
  .object({
    lines: z.array(CartLineSchema).max(MAX_CART_LINES),
    promoCode: z.string().trim().min(2).max(20).nullable(),
    unloadHelpStoreIds: z.array(z.string().min(1).max(40)).max(5),
    fulfilment: z.enum(['delivery', 'pickup']),
    jobsiteId: z.string().min(1).max(100).nullable(),
  })
  .strict() satisfies z.ZodType<CartInput, unknown>;
