/**
 * The old `onProductWritten` (docs/PLATFORM.md §9.4, MARKETPLACE §5.6): the server-only columns of a product,
 * computed in the transaction that writes it. `listed` is a generated column (`active AND store_status =
 * 'live'`) and `imageUrl` comes from the serializer, so neither needs code here. Nothing reacts to the
 * write, so no loop is possible. Product PUT and PATCH call it, and `seed --demo` may too.
 */
import { buildSearchTerms, type Category, type Product, type Store } from '@instasupply/shared';
import type { ProductColumns } from './products.repository';

type SearchFields = Pick<Product, 'name' | 'brand' | 'sku' | 'size' | 'familyKey'>;

/** `buildSearchTerms(name, [brand, sku, size, category name, …synonyms, familyKey])` (§9.2.13). */
export function searchTermsFor(
  product: SearchFields,
  category: Pick<Category, 'name' | 'synonyms'>,
): string[] {
  const extra = [
    product.brand,
    product.sku,
    product.size,
    category.name,
    ...category.synonyms,
    product.familyKey,
  ];
  return buildSearchTerms(
    product.name,
    extra.filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
}

export function deriveProductColumns(
  input: SearchFields,
  store: Pick<Store, 'name' | 'status'>,
  category: Pick<Category, 'name' | 'synonyms'>,
): ProductColumns {
  return {
    searchTerms: searchTermsFor(input, category),
    storeName: store.name,
    storeStatus: store.status,
  };
}
