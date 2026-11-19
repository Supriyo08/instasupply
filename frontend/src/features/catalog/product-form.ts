/**
 * Product form state, validation and ids. Validation mirrors `isValidProduct` in
 * firebase/firestore.rules so a save is never rejected by the rules for bad input.
 */
import { formatCurrency, type Product } from '@instasupply/shared';

export const NAME_MAX = 80;
export const UNIT_MAX = 30;
export const DESCRIPTION_MAX = 2000;
export const IMAGE_URL_MAX = 2048;
export const PRICE_MAX = 100_000;
export const STOCK_MAX = 99_999;

export type ProductBadge = NonNullable<Product['badge']>;

export const BADGE_LABELS: Record<ProductBadge, string> = {
  new: 'New',
  bestseller: 'Bestseller',
  organic: 'Organic',
};

export const BADGE_OPTIONS: { value: ProductBadge | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'new', label: BADGE_LABELS.new },
  { value: 'bestseller', label: BADGE_LABELS.bestseller },
  { value: 'organic', label: BADGE_LABELS.organic },
];

/** Fields staff edit. Ratings, search terms and timestamps are maintained separately. */
export interface ProductValues {
  name: string;
  categoryId: string;
  unit: string;
  price: number;
  mrp: number | null;
  stock: number;
  description: string;
  badge: Product['badge'];
  imageKey: string | null;
  imageUrl: string | null;
  active: boolean;
  featured: boolean;
}

/** Editable form state: numbers stay strings until validation so inputs behave naturally. */
export interface ProductDraft {
  name: string;
  categoryId: string;
  unit: string;
  price: string;
  mrp: string;
  stock: string;
  description: string;
  badge: ProductBadge | 'none';
  imageKey: string | null;
  imageUrl: string;
  active: boolean;
  featured: boolean;
}

export type ProductErrors = Partial<Record<keyof ProductDraft | 'form', string>>;

export function emptyProductDraft(categoryId = ''): ProductDraft {
  return {
    name: '',
    categoryId,
    unit: '',
    price: '',
    mrp: '',
    stock: '',
    description: '',
    badge: 'none',
    imageKey: null,
    imageUrl: '',
    active: true,
    featured: false,
  };
}

/** The editable fields of a stored product (tolerant of older documents missing optional fields). */
export function productToValues(product: Product): ProductValues {
  return {
    name: product.name,
    categoryId: product.categoryId,
    unit: product.unit,
    price: product.price,
    mrp: product.mrp ?? null,
    stock: product.stock,
    description: product.description ?? '',
    badge: product.badge ?? null,
    imageKey: product.imageKey ?? null,
    imageUrl: product.imageUrl ?? null,
    active: product.active,
    featured: product.featured,
  };
}

export function productToDraft(product: Product): ProductDraft {
  const values = productToValues(product);
  return {
    name: values.name,
    categoryId: values.categoryId,
    unit: values.unit,
    price: String(values.price),
    mrp: values.mrp != null ? String(values.mrp) : '',
    stock: String(values.stock),
    description: values.description,
    badge: values.badge ?? 'none',
    imageKey: values.imageKey,
    imageUrl: values.imageUrl ?? '',
    active: values.active,
    featured: values.featured,
  };
}

const collapse = (value: string) => value.trim().replace(/\s+/g, ' ');

/** A number typed by staff, or null when empty or not a number. */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Whole units between 0 and STOCK_MAX. Rules require an integer, and Firestore stores -0 (and any
 * fraction) as a double, so always round and normalise.
 */
export function toStock(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(STOCK_MAX, Math.max(0, Math.round(value))) || 0;
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E };

export function validateProductDraft(
  draft: ProductDraft,
  categoryIds: ReadonlySet<string>,
): Result<ProductValues, ProductErrors> {
  const errors: ProductErrors = {};

  const name = collapse(draft.name);
  if (!name) errors.name = 'Enter the product name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;

  if (!categoryIds.has(draft.categoryId)) errors.categoryId = 'Choose a category.';

  const unit = collapse(draft.unit);
  if (!unit) errors.unit = 'Enter the pack size, e.g. 1 kg or 6 pcs.';
  else if (unit.length > UNIT_MAX) errors.unit = `Keep the pack size under ${UNIT_MAX} characters.`;

  const parsedPrice = parseNumber(draft.price);
  const price = parsedPrice === null ? null : roundMoney(parsedPrice);
  if (price === null) errors.price = 'Enter the selling price.';
  else if (price < 0) errors.price = "The price can't be negative.";
  else if (price > PRICE_MAX) errors.price = `Enter a price up to ${formatCurrency(PRICE_MAX)}.`;

  const parsedMrp = parseNumber(draft.mrp);
  const mrp = parsedMrp === null ? null : roundMoney(parsedMrp);
  if (draft.mrp.trim() && mrp === null) errors.mrp = 'Enter a number, or leave it empty.';
  else if (mrp !== null && price !== null && mrp <= price)
    errors.mrp = 'The MRP must be higher than the price.';
  else if (mrp !== null && mrp > PRICE_MAX) errors.mrp = `Enter an MRP up to ${formatCurrency(PRICE_MAX)}.`;

  const stock = parseNumber(draft.stock);
  if (stock === null) errors.stock = 'Enter how many units are in stock.';
  else if (!Number.isInteger(stock) || stock < 0) errors.stock = 'Use a whole number, 0 or more.';
  else if (stock > STOCK_MAX) errors.stock = `Enter at most ${STOCK_MAX.toLocaleString()} units.`;

  const description = draft.description.trim();
  if (description.length > DESCRIPTION_MAX) {
    errors.description = `Keep the description under ${DESCRIPTION_MAX.toLocaleString()} characters.`;
  }

  const imageUrl = draft.imageUrl.trim();
  if (imageUrl && (imageUrl.length > IMAGE_URL_MAX || !isHttpsUrl(imageUrl))) {
    errors.imageUrl = 'Use a full https:// link to an image, or leave it empty.';
  }

  if (Object.keys(errors).length > 0 || price === null || stock === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      categoryId: draft.categoryId,
      unit,
      price,
      mrp,
      stock: toStock(stock),
      description,
      badge: draft.badge === 'none' ? null : draft.badge,
      imageKey: draft.imageKey || null,
      imageUrl: imageUrl || null,
      active: draft.active,
      featured: draft.featured,
    },
  };
}

/** Only the fields that changed, so a save never overwrites stock sold (or toggles flipped) meanwhile. */
export function productChanges(before: ProductValues, after: ProductValues): Partial<ProductValues> {
  const keys = Object.keys(after) as (keyof ProductValues)[];
  return Object.fromEntries(
    keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]),
  ) as Partial<ProductValues>;
}

export function sameTerms(a: readonly string[] | null | undefined, b: readonly string[]): boolean {
  return !!a && a.length === b.length && a.every((term, index) => term === b[index]);
}

/** Readable document id: "Red & Yellow Peppers" → "red-and-yellow-peppers". */
export function slugify(text: string, fallback: string, maxLength = 56): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug || fallback;
}

/** `base`, `base-2`, `base-3`… skipping ids already known to be taken. */
export function* slugCandidates(base: string, taken: ReadonlySet<string>, attempts = 50): Generator<string> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    if (!taken.has(candidate)) yield candidate;
  }
}
