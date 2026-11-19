/** Client-side filtering, sorting and stock levels for the catalogue (a few hundred products). */
import type { Product } from '@instasupply/shared';

/**
 * Active products with this many units or fewer (but at least one) count as low stock. The back
 * office's only copy: the dashboard's low-stock card uses it too.
 */
export const LOW_STOCK_LIMIT = 10;

export type StatusFilter = 'all' | 'active' | 'hidden' | 'low' | 'out';
export type SortKey = 'name' | 'price-asc' | 'price-desc' | 'stock-asc' | 'stock-desc' | 'rating';
export type StockLevel = 'out' | 'low' | 'ok';

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
];

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'stock-asc', label: 'Stock: lowest first' },
  { value: 'stock-desc', label: 'Stock: highest first' },
  { value: 'rating', label: 'Top rated' },
];

export function parseStatus(value: string | null): StatusFilter {
  return STATUS_OPTIONS.find((option) => option.value === value)?.value ?? 'all';
}

export function parseSort(value: string | null): SortKey {
  return SORT_OPTIONS.find((option) => option.value === value)?.value ?? 'name';
}

type Stocked = Pick<Product, 'stock' | 'active'>;

/** Out = nothing left; low = active and 1…10 left. */
export function stockLevel(product: Stocked): StockLevel {
  if (product.stock <= 0) return 'out';
  if (product.active && product.stock <= LOW_STOCK_LIMIT) return 'low';
  return 'ok';
}

export function matchesStatus(product: Stocked, status: StatusFilter): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'active':
      return product.active;
    case 'hidden':
      return !product.active;
    case 'low':
    case 'out':
      return stockLevel(product) === status;
  }
}

/** Products in `categoryId` (all when empty) whose name contains every word of `search`. */
export function filterProducts<T extends Pick<Product, 'name' | 'categoryId'>>(
  products: readonly T[],
  { search, categoryId }: { search: string; categoryId: string },
): T[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter((product) => {
    if (categoryId && product.categoryId !== categoryId) return false;
    if (words.length === 0) return true;
    const name = product.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

type Sortable = Pick<Product, 'name' | 'price' | 'stock' | 'rating' | 'ratingCount'>;

export function sortProducts<T extends Sortable>(products: readonly T[], sort: SortKey): T[] {
  const byName = (a: T, b: T) => collator.compare(a.name, b.name);
  const compare: Record<SortKey, (a: T, b: T) => number> = {
    name: byName,
    'price-asc': (a, b) => a.price - b.price || byName(a, b),
    'price-desc': (a, b) => b.price - a.price || byName(a, b),
    'stock-asc': (a, b) => a.stock - b.stock || byName(a, b),
    'stock-desc': (a, b) => b.stock - a.stock || byName(a, b),
    rating: (a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || byName(a, b),
  };
  return [...products].sort(compare[sort]);
}

export interface CatalogSummary {
  total: number;
  hidden: number;
  low: number;
  out: number;
}

export function summarize(products: readonly Stocked[]): CatalogSummary {
  const summary: CatalogSummary = { total: products.length, hidden: 0, low: 0, out: 0 };
  for (const product of products) {
    if (!product.active) summary.hidden += 1;
    const level = stockLevel(product);
    if (level !== 'ok') summary[level] += 1;
  }
  return summary;
}

/** Active and total product counts per category id. */
export function countByCategory(
  products: readonly Pick<Product, 'categoryId' | 'active'>[],
): Map<string, { active: number; total: number }> {
  const counts = new Map<string, { active: number; total: number }>();
  for (const product of products) {
    const entry = counts.get(product.categoryId) ?? { active: 0, total: 0 };
    entry.total += 1;
    if (product.active) entry.active += 1;
    counts.set(product.categoryId, entry);
  }
  return counts;
}
