/**
 * Catalogue filters, ordering and money input for the supplier portal and the ops catalogue
 * (MARKETPLACE §8 `/portal/catalog`, §9 `/catalog`). Availability and the low-stock line come from
 * shared (`availableQty`, `LOW_STOCK_THRESHOLD`): never re-derived here.
 */
import { LOW_STOCK_THRESHOLD, availableQty, type Product } from '@instasupply/shared';
import { useState } from 'react';

export type SortKey = 'name' | 'available' | 'price';

export interface CatalogFilters {
  q: string;
  categoryId: string;
  /** Fewer than `LOW_STOCK_THRESHOLD` (10) available. */
  lowStock: boolean;
  inactive: boolean;
  /** Weight or size filled from the category defaults. */
  estimated: boolean;
  sort: SortKey;
}

export const EMPTY_FILTERS: CatalogFilters = {
  q: '',
  categoryId: '',
  lowStock: false,
  inactive: false,
  estimated: false,
  sort: 'name',
};

export const isLowStock = (product: Pick<Product, 'stockOnHand' | 'reserved'>) =>
  availableQty(product) < LOW_STOCK_THRESHOLD;

/** Search text over name, SKU, brand and size, case- and accent-insensitive. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesFilters(product: Product, filters: CatalogFilters): boolean {
  if (filters.categoryId && product.categoryId !== filters.categoryId) return false;
  if (filters.lowStock && !isLowStock(product)) return false;
  if (filters.inactive && product.active) return false;
  if (filters.estimated && !product.shipEstimated) return false;
  const term = normalize(filters.q.trim());
  if (term) {
    const haystack = normalize(
      [product.name, product.sku, product.brand ?? '', product.size ?? ''].join(' '),
    );
    if (!term.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return true;
}

export function compareProducts(sort: SortKey): (a: Product, b: Product) => number {
  const byName = (a: Product, b: Product) =>
    a.name.localeCompare(b.name, 'en-CA') || a.id.localeCompare(b.id);
  switch (sort) {
    case 'available':
      return (a, b) => availableQty(a) - availableQty(b) || byName(a, b);
    case 'price':
      return (a, b) => a.priceCents - b.priceCents || byName(a, b);
    default:
      return byName;
  }
}

interface Frozen {
  key: string;
  universe: string;
  ids: string[];
}

/**
 * Review fix ux #1: which rows are shown, and in what order, is frozen while people edit inline. It is
 * recomputed only when the filters or sort change, or when products are added or removed; an edit to
 * stock, price or the active switch never moves a row or drops it from under the pointer (a row that
 * stops matching "Low stock" stays, showing its new numbers, until the filters change).
 */
export function useFrozenRows(
  products: readonly Product[],
  filters: CatalogFilters,
  sortKey: string,
): Product[] {
  const key = JSON.stringify({ ...filters, sortKey });
  const universe = products
    .map((product) => product.id)
    .sort()
    .join('\n');
  const compute = (): Frozen => ({
    key,
    universe,
    ids: products
      .filter((product) => matchesFilters(product, filters))
      .sort(compareProducts(filters.sort))
      .map((product) => product.id),
  });
  const [frozen, setFrozen] = useState<Frozen>(compute);
  let current = frozen;
  if (frozen.key !== key || frozen.universe !== universe) {
    current = compute();
    setFrozen(current);
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  return current.ids.map((id) => byId.get(id)).filter((product): product is Product => product !== undefined);
}

/** "12.99", "$1,299", "0.5" → cents; null when it is not an amount with at most two decimals. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  const match = /^(\d{1,7})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0') || '0');
  return whole * 100 + cents;
}

/** Cents → "12.99" for an input field (no currency sign, no grouping). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const whole = Math.trunc(cents / 100);
  return `${whole}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;
}
