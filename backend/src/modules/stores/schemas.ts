/**
 * zod schemas of the catalogue and store requests (docs/PLATFORM.md §5.2, §5.3.4). Strict objects: an unknown
 * key is an invalid-argument, which is what refuses `reserved`, `listed`, `storeId`, `imageUrl` or
 * `searchTerms` on a product. The domain rules (lengths, ranges, hours, upload folders) are the shared
 * validators', applied by the services on the parsed value (validateProduct, validateStore,
 * validateStoreProfile), so a form and the server refuse the same things.
 */
import {
  CATEGORY_IDS,
  CITY_IDS,
  SELL_UNITS,
  STORE_SPECIALTY_LABELS,
  isStoreId,
  type StoreSpecialty,
  type CategoryInput,
  type CreateStoreRequest,
  type ProductPatch,
  type ReviewInput,
  type RestProductInput,
  type StorePrivateSettings,
  type UpdateStoreProfileRequest,
  type UpdateStoreSettingsRequest,
} from '@instasupply/shared';
import { z } from 'zod';
import { MAX_LIMIT, pageQuerySchema } from '../../platform/http/pagination';

/** A zod enum over one of the shared constant lists. */
const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]);

const categoryId = enumOf(CATEGORY_IDS);
const sellUnit = enumOf(SELL_UNITS);
const badge = z.enum(['new', 'bestseller', 'deal']);
const dims = z.object({ l: z.number(), w: z.number(), h: z.number() }).strict();
const latLng = z.object({ lat: z.number(), lng: z.number() }).strict();
const nullableText = (max: number) => z.string().max(max).nullable();

export const storeIdSchema = z
  .string()
  .refine(
    (value) => isStoreId(value),
    'A store id is a slug of 3 to 40 lower-case letters, digits and dashes.',
  );

// ---------- products ----------

const productFields = {
  sku: z.string().max(80),
  name: z.string().max(240),
  brand: nullableText(120),
  categoryId,
  unit: sellUnit,
  size: nullableText(120),
  description: z.string().max(4000),
  priceCents: z.number(),
  compareAtCents: z.number().nullable(),
  stockOnHand: z.number(),
  maxPerOrder: z.number().nullable(),
  weightKg: z.number(),
  dimsCm: dims,
  shipEstimated: z.boolean(),
  active: z.boolean(),
  imageKey: nullableText(120),
  imagePath: nullableText(300),
  featured: z.boolean().optional(),
  badge: badge.nullable().optional(),
  familyKey: nullableText(120).optional(),
};

export const ProductInputSchema = z.object(productFields).strict() satisfies z.ZodType<RestProductInput>;

const { sku: _sku, ...patchFields } = productFields;
export const ProductPatchSchema = z.object(patchFields).partial().strict() satisfies z.ZodType<ProductPatch>;

export const StockAdjustSchema = z
  .object({
    delta: z
      .number()
      .int('The change must be a whole number.')
      .min(-1_000_000)
      .max(1_000_000)
      .refine((value) => value !== 0, 'The change cannot be 0.'),
  })
  .strict();

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const csv = <T extends string>(max: number, each: z.ZodType<T, string>) =>
  z
    .string()
    .max(max * 120)
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .pipe(z.array(each).max(max, `At most ${max} values.`));

export const productListQuery = pageQuerySchema.extend({
  listed: z.literal('true').optional(),
  ids: csv(100, z.string().min(1).max(100)).optional(),
  q: z.string().max(200).optional(),
  categoryId: categoryId.optional(),
  storeId: z.string().min(1).max(40).optional(),
  familyKey: z.string().min(1).max(120).optional(),
  featured: z.literal('true').optional(),
  inStock: z.literal('true').optional(),
  active: flag.optional(),
  lowStock: z.literal('true').optional(),
  estimated: z.literal('true').optional(),
  sort: z.enum(['name:asc', 'priceCents:asc']).default('name:asc'),
});
export type ProductListQuery = z.infer<typeof productListQuery>;

// ---------- categories ----------

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #E6F2EA.');

const categoryFields = {
  name: z
    .string()
    .trim()
    .min(1, 'Enter a category name.')
    .max(40, 'A category name has at most 40 characters.'),
  iconKey: z.string().trim().min(1).max(60),
  tint: hex,
  accent: hex,
  sortOrder: z.number().int().min(1).max(1000),
  defaultWeightKg: z.number().positive().max(3000),
  defaultDimsCm: z
    .object({
      l: z.number().positive().max(1500),
      w: z.number().positive().max(1500),
      h: z.number().positive().max(1500),
    })
    .strict(),
  synonyms: z.array(z.string().trim().min(1).max(40)).max(40),
  active: z.boolean(),
};

export const CategoryInputSchema = z.object(categoryFields).strict() satisfies z.ZodType<CategoryInput>;
export const CategoryPatchSchema = z.object(categoryFields).partial().strict() satisfies z.ZodType<
  Partial<CategoryInput>
>;
export const categoryParams = z.object({ id: categoryId });
export const ReorderCategoriesSchema = z
  .object({ ids: z.array(categoryId).min(1).max(CATEGORY_IDS.length) })
  .strict();

// ---------- stores ----------

export const storeListQuery = z.object({
  marketId: z.literal('gta').default('gta'),
  status: csv(4, z.enum(['onboarding', 'coming_soon', 'live', 'closed'])).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(MAX_LIMIT),
  cursor: z.string().min(1).max(500).optional(),
});

const hoursValue = z
  .object({ open: z.string().max(5), close: z.string().max(5) })
  .strict()
  .nullable();
const weekHours = z
  .object({
    mon: hoursValue,
    tue: hoursValue,
    wed: hoursValue,
    thu: hoursValue,
    fri: hoursValue,
    sat: hoursValue,
    sun: hoursValue,
  })
  .strict();
const address = z
  .object({
    line1: z.string().max(200),
    line2: nullableText(120),
    city: z.string().max(120),
    province: z.literal('ON'),
    postalCode: nullableText(10),
  })
  .strict();

const storeDocFields = {
  name: z.string().max(160),
  specialty: enumOf(Object.keys(STORE_SPECIALTY_LABELS) as StoreSpecialty[]),
  categoryIds: z.array(categoryId).max(CATEGORY_IDS.length),
  description: z.string().max(4000),
  marketId: z.literal('gta'),
  cityId: enumOf(CITY_IDS),
  areaLabel: z.string().max(160),
  address,
  location: latLng,
  phone: z.string().max(40),
  email: nullableText(254),
  /** Set by the server from a store_photo upload (updateStoreProfile.patch.photoPath); a new store has none. */
  photoUrl: z.null({ message: 'Add the store photo with an upload after the store exists.' }),
  imageKey: nullableText(60),
  hours: weekHours,
  closures: z.array(z.string().max(10)).max(366),
  fulfilment: z.object({ delivery: z.boolean(), pickup: z.boolean(), deliveryRadiusKm: z.number() }).strict(),
  prepMinutes: z.number(),
  sameDayCutoff: z.string().max(5),
  status: z.enum(['onboarding', 'coming_soon', 'live', 'closed']),
  acceptingOrders: z.boolean(),
};

const settingsFields = {
  commissionBps: z
    .number()
    .int('The commission is a whole number of basis points.')
    .min(0)
    .max(3000, 'The commission is at most 3 000 basis points (30 %).'),
  payoutAccount: z
    .object({
      provider: z.enum(['test', 'stripe']),
      accountRef: z.string().trim().min(1).max(120),
      label: z.string().trim().min(1).max(80),
    })
    .strict()
    .nullable(),
  ordersEmail: nullableText(254),
  alertPhone: nullableText(40),
  loadingNotes: nullableText(500),
  onboarding: z
    .object({ catalogReady: z.boolean(), payoutsReady: z.boolean(), trained: z.boolean() })
    .strict(),
  notes: nullableText(2000),
};

export const StorePrivateSettingsSchema = z
  .object(settingsFields)
  .strict() satisfies z.ZodType<StorePrivateSettings>;

export const CreateStoreRequestSchema = z
  .object({
    storeId: storeIdSchema,
    store: z.object(storeDocFields).strict(),
    settings: StorePrivateSettingsSchema,
  })
  .strict() satisfies z.ZodType<CreateStoreRequest>;

const { photoUrl: _photo, ...editableDocFields } = storeDocFields;
export const UpdateStoreSettingsRequestSchema = z
  .object({
    storeId: storeIdSchema,
    store: z
      .object({
        name: editableDocFields.name,
        specialty: editableDocFields.specialty,
        categoryIds: editableDocFields.categoryIds,
        description: editableDocFields.description,
        address: editableDocFields.address,
        location: editableDocFields.location,
        cityId: editableDocFields.cityId,
        areaLabel: editableDocFields.areaLabel,
        status: editableDocFields.status,
        deliveryRadiusKm: z.number(),
      })
      .partial()
      .strict()
      .optional(),
    settings: z.object(settingsFields).partial().strict().optional(),
  })
  .strict() satisfies z.ZodType<UpdateStoreSettingsRequest>;

export const UpdateStoreProfileRequestSchema = z
  .object({
    storeId: storeIdSchema,
    patch: z
      .object({
        description: z.string().max(4000),
        phone: z.string().max(40),
        email: nullableText(254),
        hours: weekHours,
        closures: z.array(z.string().max(10)).max(366),
        prepMinutes: z.number(),
        sameDayCutoff: z.string().max(5),
        acceptingOrders: z.boolean(),
        fulfilment: z.object({ delivery: z.boolean(), pickup: z.boolean() }).partial().strict(),
        photoPath: nullableText(300),
        loadingNotes: nullableText(1000),
        alertPhone: nullableText(40),
      })
      .partial()
      .strict(),
  })
  .strict() satisfies z.ZodType<UpdateStoreProfileRequest>;

// ---------- reviews ----------

export const ReviewInputSchema = z
  .object({
    rating: z
      .number()
      .int('Choose 1 to 5 stars.')
      .min(1, 'Choose 1 to 5 stars.')
      .max(5, 'Choose 1 to 5 stars.'),
    text: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(1000, 'A review has at most 1,000 characters.')),
  })
  .strict() satisfies z.ZodType<ReviewInput>;

export const reviewListQuery = pageQuerySchema.extend({
  sort: z.enum(['updatedAt:desc']).default('updatedAt:desc'),
});
