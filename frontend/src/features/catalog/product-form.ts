/**
 * The product form (MARKETPLACE §8 add/edit modal): every product field as text, converted and checked
 * with `validateProduct` from shared, the function the server runs. Weight and size start from the
 * category's shipping defaults with "Estimated" ticked; the SKU is fixed after creation because it is
 * part of the product id (`{storeId}--{skuSlug}`).
 */
import type { ProductInput, ProductPatch } from '@instasupply/api-client';
import {
  CATEGORIES,
  validateProduct,
  type CategoryId,
  type Product,
  type ProductBadge,
  type SellUnit,
} from '@instasupply/shared';

import { centsToInput, parseDollars } from './catalog-model';

export interface ProductDraft {
  sku: string;
  name: string;
  brand: string;
  categoryId: CategoryId | '';
  unit: SellUnit;
  size: string;
  description: string;
  price: string;
  compareAt: string;
  stockOnHand: string;
  maxPerOrder: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  shipEstimated: boolean;
  active: boolean;
  imageKey: string | null;
  imagePath: string | null;
  // Staff only.
  featured: boolean;
  badge: ProductBadge | '';
  familyKey: string;
}

export type ProductErrors = Partial<Record<keyof ProductInput | 'form' | 'price' | 'compareAt', string>>;

const num = (value: number | null | undefined) => (value == null ? '' : String(value));

export function emptyDraft(categoryId: CategoryId | ''): ProductDraft {
  const draft: ProductDraft = {
    sku: '',
    name: '',
    brand: '',
    categoryId,
    unit: 'each',
    size: '',
    description: '',
    price: '',
    compareAt: '',
    stockOnHand: '0',
    maxPerOrder: '',
    weightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    shipEstimated: true,
    active: true,
    imageKey: null,
    imagePath: null,
    featured: false,
    badge: '',
    familyKey: '',
  };
  return categoryId ? withCategoryDefaults(draft, categoryId) : draft;
}

/** Fills empty weight and size from the category defaults and ticks "Estimated" (MARKETPLACE §1.5). */
export function withCategoryDefaults(draft: ProductDraft, categoryId: CategoryId): ProductDraft {
  const category = CATEGORIES[categoryId];
  if (!category) return draft;
  const next = { ...draft, categoryId };
  const sizeEmpty = !draft.lengthCm && !draft.widthCm && !draft.heightCm;
  if (!draft.weightKg) next.weightKg = String(category.defaultWeightKg);
  if (sizeEmpty) {
    next.lengthCm = String(category.defaultDimsCm.l);
    next.widthCm = String(category.defaultDimsCm.w);
    next.heightCm = String(category.defaultDimsCm.h);
  }
  if (!draft.weightKg || sizeEmpty) next.shipEstimated = true;
  return next;
}

export function draftFromProduct(product: Product): ProductDraft {
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand ?? '',
    categoryId: product.categoryId,
    unit: product.unit,
    size: product.size ?? '',
    description: product.description,
    price: centsToInput(product.priceCents),
    compareAt: centsToInput(product.compareAtCents),
    stockOnHand: String(product.stockOnHand),
    maxPerOrder: num(product.maxPerOrder),
    weightKg: num(product.weightKg),
    lengthCm: num(product.dimsCm.l),
    widthCm: num(product.dimsCm.w),
    heightCm: num(product.dimsCm.h),
    shipEstimated: product.shipEstimated,
    active: product.active,
    imageKey: product.imageKey,
    imagePath: product.imagePath,
    featured: product.featured,
    badge: product.badge ?? '',
    familyKey: product.familyKey ?? '',
  };
}

const toNumberOrText = (text: string) => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : trimmed;
};

type ValidateResult = { ok: true; value: ProductInput } | { ok: false; errors: ProductErrors };

/** Draft → `ProductInput`, checked like the server does. Staff-only fields are sent by staff only. */
export function validateDraft(draft: ProductDraft, storeId: string, staff: boolean): ValidateResult {
  const errors: ProductErrors = {};
  const priceCents = parseDollars(draft.price);
  if (priceCents === null) errors.price = 'Enter a price such as 12.99.';
  const compareAtCents = draft.compareAt.trim() ? parseDollars(draft.compareAt) : null;
  if (draft.compareAt.trim() && compareAtCents === null)
    errors.compareAt = 'Enter a price such as 14.99, or leave empty.';

  const raw: Record<string, unknown> = {
    sku: draft.sku.trim(),
    name: draft.name.trim(),
    brand: draft.brand.trim() || null,
    categoryId: draft.categoryId || null,
    unit: draft.unit,
    size: draft.size.trim() || null,
    description: draft.description.trim(),
    priceCents: priceCents ?? 0,
    compareAtCents,
    stockOnHand: toNumberOrText(draft.stockOnHand),
    maxPerOrder: toNumberOrText(draft.maxPerOrder),
    weightKg: toNumberOrText(draft.weightKg),
    dimsCm:
      draft.lengthCm || draft.widthCm || draft.heightCm
        ? {
            l: toNumberOrText(draft.lengthCm),
            w: toNumberOrText(draft.widthCm),
            h: toNumberOrText(draft.heightCm),
          }
        : null,
    shipEstimated: draft.shipEstimated,
    active: draft.active,
    imageKey: draft.imageKey,
    imagePath: draft.imagePath,
  };
  if (staff) {
    raw.featured = draft.featured;
    raw.badge = draft.badge || null;
    raw.familyKey = draft.familyKey.trim() || null;
  }
  const result = validateProduct(raw, storeId);
  if (!result.ok) {
    const serverErrors = result.errors as ProductErrors;
    if (serverErrors.priceCents && !errors.price) errors.price = serverErrors.priceCents;
    if (serverErrors.compareAtCents && !errors.compareAt) errors.compareAt = serverErrors.compareAtCents;
    return { ok: false, errors: { ...serverErrors, ...errors } };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const value: ProductInput = { ...result.value };
  if (!staff) {
    delete value.featured;
    delete value.badge;
    delete value.familyKey;
  }
  return { ok: true, value };
}

/**
 * The fields that changed against the product as it was when the form opened: an edit never re-sends
 * values someone else changed meanwhile. `stockOnHand` is never patched here; counts change through
 * the stock-adjust endpoint, which is safe against sales at the same moment.
 */
export function patchFrom(next: ProductInput, original: ProductInput): ProductPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof ProductInput)[]) {
    if (key === 'sku' || key === 'stockOnHand') continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(original[key])) patch[key] = next[key];
  }
  return patch as ProductPatch;
}

/** The product as the form would send it, for `patchFrom`. */
export function inputFromProduct(product: Product, staff: boolean): ProductInput {
  const input: ProductInput = {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    categoryId: product.categoryId,
    unit: product.unit,
    size: product.size,
    description: product.description,
    priceCents: product.priceCents,
    compareAtCents: product.compareAtCents,
    stockOnHand: product.stockOnHand,
    maxPerOrder: product.maxPerOrder,
    weightKg: product.weightKg,
    dimsCm: product.dimsCm,
    shipEstimated: product.shipEstimated,
    active: product.active,
    imageKey: product.imageKey,
    imagePath: product.imagePath,
  };
  if (staff) {
    input.featured = product.featured;
    input.badge = product.badge;
    input.familyKey = product.familyKey;
  }
  return input;
}
