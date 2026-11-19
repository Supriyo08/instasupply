/**
 * Category form state, validation and ordering. Category writes are not validated by the security
 * rules (any staff member may write), so everything is checked here.
 */
import type { Category } from '@instasupply/shared';

import { slugify } from './product-form';

export const CATEGORY_NAME_MAX = 40;
export const CATEGORY_ID_MAX = 60;
export const SORT_ORDER_LIMIT = 99_999;
export const DEFAULT_TINT = '#EEF2FF';
export const DEFAULT_ACCENT = '#4F46E5';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export type CategoryValues = Omit<Category, 'id'>;

export interface CategoryDraft {
  id: string;
  name: string;
  iconKey: string;
  tint: string;
  accent: string;
  sortOrder: string;
}

export type CategoryErrors = Partial<Record<keyof CategoryDraft | 'form', string>>;

/** "#abc", "aabbcc" → "#AABBCC"; null when it isn't a hex colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  const digits = HEX_PATTERN.exec(value?.trim() ?? '')?.[1];
  if (!digits) return null;
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return `#${full.toUpperCase()}`;
}

export const suggestCategoryId = (name: string) => slugify(name, '', CATEGORY_ID_MAX);

export function nextSortOrder(categories: readonly Pick<Category, 'sortOrder'>[]): number {
  return categories.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;
}

export function emptyCategoryDraft(sortOrder: number, iconKey: string): CategoryDraft {
  return {
    id: '',
    name: '',
    iconKey,
    tint: DEFAULT_TINT,
    accent: DEFAULT_ACCENT,
    sortOrder: String(sortOrder),
  };
}

export function categoryToDraft(category: Category): CategoryDraft {
  return {
    id: category.id,
    name: category.name,
    iconKey: category.iconKey ?? '',
    tint: category.tint ?? DEFAULT_TINT,
    accent: category.accent ?? DEFAULT_ACCENT,
    sortOrder: String(category.sortOrder),
  };
}

type Result = { ok: true; id: string; value: CategoryValues } | { ok: false; errors: CategoryErrors };

export function validateCategoryDraft(
  draft: CategoryDraft,
  options: {
    /** Set when editing: the id is fixed and the current icon may stay even if it left the art set. */
    existing: Category | null;
    takenIds: ReadonlySet<string>;
    iconKeys: readonly string[];
  },
): Result {
  const errors: CategoryErrors = {};
  const { existing } = options;

  const name = draft.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Enter the category name.';
  else if (name.length > CATEGORY_NAME_MAX)
    errors.name = `Keep the name under ${CATEGORY_NAME_MAX} characters.`;

  const id = existing ? existing.id : draft.id.trim();
  if (!existing) {
    if (!id) errors.id = 'Enter an ID.';
    else if (id.length > CATEGORY_ID_MAX) errors.id = `Keep the ID under ${CATEGORY_ID_MAX} characters.`;
    else if (!ID_PATTERN.test(id)) errors.id = 'Use lowercase letters, numbers and single hyphens.';
    else if (options.takenIds.has(id)) errors.id = 'Another category already uses this ID.';
  }

  const keepsIcon = !!existing && draft.iconKey === existing.iconKey;
  if (options.iconKeys.length > 0 && !keepsIcon && !options.iconKeys.includes(draft.iconKey)) {
    errors.iconKey = 'Choose an icon.';
  }

  const tint = normalizeHex(draft.tint);
  if (!tint) errors.tint = 'Use a hex colour such as #E6F2EA.';
  const accent = normalizeHex(draft.accent);
  if (!accent) errors.accent = 'Use a hex colour such as #28B446.';

  const sortOrder = Number(draft.sortOrder.trim());
  if (!draft.sortOrder.trim() || !Number.isInteger(sortOrder) || Math.abs(sortOrder) > SORT_ORDER_LIMIT) {
    errors.sortOrder = 'Use a whole number.';
  }

  if (Object.keys(errors).length > 0 || !tint || !accent) return { ok: false, errors };
  return { ok: true, id, value: { name, iconKey: draft.iconKey, tint, accent, sortOrder } };
}

export function categoryChanges(before: Category, after: CategoryValues): Partial<CategoryValues> {
  const keys = Object.keys(after) as (keyof CategoryValues)[];
  return Object.fromEntries(
    keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]),
  ) as Partial<CategoryValues>;
}

/**
 * New sortOrder values to move `list[index]` one place up (-1) or down (1). Neighbours with distinct
 * values just swap; tied values can't be swapped, so the whole list is renumbered in its new order.
 */
export function reorderCategories(
  list: readonly Pick<Category, 'id' | 'sortOrder'>[],
  index: number,
  direction: -1 | 1,
): { id: string; sortOrder: number }[] {
  const target = index + direction;
  const current = list[index];
  const neighbour = list[target];
  if (!current || !neighbour) return [];
  if (current.sortOrder !== neighbour.sortOrder) {
    return [
      { id: current.id, sortOrder: neighbour.sortOrder },
      { id: neighbour.id, sortOrder: current.sortOrder },
    ];
  }
  const order = [...list];
  order[index] = neighbour;
  order[target] = current;
  return order
    .map((category, position) => ({ category, sortOrder: position + 1 }))
    .filter(({ category, sortOrder }) => category.sortOrder !== sortOrder)
    .map(({ category, sortOrder }) => ({ id: category.id, sortOrder }));
}
