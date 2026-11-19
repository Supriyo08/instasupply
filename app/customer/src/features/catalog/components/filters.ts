import { discountPercent, formatCurrency, type Product } from '@instasupply/shared';

export type SortMode = 'popularity' | 'price-asc' | 'price-desc' | 'name';

/** Client-side refinements for a product list (category or featured listing). */
export interface ProductFilters {
  minPrice: number | null;
  maxPrice: number | null;
  /** Minimum average rating; 0 means any rating. */
  minRating: number;
  discountOnly: boolean;
  inStockOnly: boolean;
  sort: SortMode;
}

export const DEFAULT_FILTERS: ProductFilters = {
  minPrice: null,
  maxPrice: null,
  minRating: 0,
  discountOnly: false,
  inStockOnly: false,
  sort: 'popularity',
};

export const SORT_OPTIONS: readonly { value: SortMode; label: string }[] = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name (A–Z)' },
];

export function sortLabel(sort: SortMode): string {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Popularity';
}

/** Bestsellers first, then featured picks and well-reviewed products; sold-out items last. */
function popularity(product: Product): number {
  const reviews = (product.rating || 0) * Math.log2((product.ratingCount || 0) + 2);
  const soldOut = product.stock <= 0 ? -1000 : 0;
  return soldOut + (product.badge === 'bestseller' ? 100 : 0) + (product.featured ? 25 : 0) + reviews * 4;
}

const byName = (a: Product, b: Product) => a.name.localeCompare(b.name);

const COMPARE: Record<SortMode, (a: Product, b: Product) => number> = {
  popularity: (a, b) => popularity(b) - popularity(a) || byName(a, b),
  'price-asc': (a, b) => a.price - b.price || byName(a, b),
  'price-desc': (a, b) => b.price - a.price || byName(a, b),
  name: byName,
};

export function applyFilters(products: readonly Product[], filters: ProductFilters): Product[] {
  return products
    .filter(
      (product) =>
        (filters.minPrice == null || product.price >= filters.minPrice) &&
        (filters.maxPrice == null || product.price <= filters.maxPrice) &&
        (product.rating || 0) >= filters.minRating &&
        (!filters.discountOnly || discountPercent(product) != null) &&
        (!filters.inStockOnly || product.stock > 0),
    )
    .sort(COMPARE[filters.sort]);
}

export interface ActiveFilter {
  key: 'price' | 'rating' | 'discount' | 'stock' | 'sort';
  label: string;
  /** The same filters with this one switched off. */
  without: (filters: ProductFilters) => ProductFilters;
}

function priceLabel(minPrice: number | null, maxPrice: number | null): string {
  if (minPrice != null && maxPrice != null)
    return `${formatCurrency(minPrice)} – ${formatCurrency(maxPrice)}`;
  if (minPrice != null) return `From ${formatCurrency(minPrice)}`;
  return `Up to ${formatCurrency(maxPrice)}`;
}

/** Removable chips describing everything that differs from the defaults. */
export function activeFilters(filters: ProductFilters): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filters.minPrice != null || filters.maxPrice != null) {
    active.push({
      key: 'price',
      label: priceLabel(filters.minPrice, filters.maxPrice),
      without: (current) => ({ ...current, minPrice: null, maxPrice: null }),
    });
  }
  if (filters.minRating > 0) {
    active.push({
      key: 'rating',
      label: `${filters.minRating}+ ${filters.minRating === 1 ? 'star' : 'stars'}`,
      without: (current) => ({ ...current, minRating: 0 }),
    });
  }
  if (filters.discountOnly) {
    active.push({
      key: 'discount',
      label: 'On discount',
      without: (current) => ({ ...current, discountOnly: false }),
    });
  }
  if (filters.inStockOnly) {
    active.push({
      key: 'stock',
      label: 'In stock',
      without: (current) => ({ ...current, inStockOnly: false }),
    });
  }
  if (filters.sort !== DEFAULT_FILTERS.sort) {
    active.push({
      key: 'sort',
      label: sortLabel(filters.sort),
      without: (current) => ({ ...current, sort: DEFAULT_FILTERS.sort }),
    });
  }
  return active;
}

/** Whole rupees typed into a price field, or null when empty. */
export function parsePrice(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}
