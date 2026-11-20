/**
 * Catalogue writes over the API (CLIENTS §4.2). The server validates every product and category,
 * builds the search fields and owns the ids (`{storeId}--{skuSlug}`), so nothing here builds search
 * terms or slugs in a transaction any more.
 */
import type { CategoryInput, ProductInput, ProductPatch } from '@instasupply/api-client';
import { productIdFor } from '@instasupply/shared';

import { api } from '@/lib/api';

/** Creates a product under `{storeId}--{sku}`. Rejects with `already-exists` when the SKU is taken in that store. */
export async function createProduct(storeId: string, input: ProductInput) {
  return api.products.create(productIdFor(storeId, input.sku), input);
}

export async function updateProduct(productId: string, patch: ProductPatch) {
  return api.products.update(productId, patch);
}

/**
 * Adds or removes units on hand (± nudges). The server applies the delta atomically, so a sale at
 * the same moment is never overwritten. Not retry-safe: after a lost answer, reload the product
 * before adjusting again (PLATFORM §4.5).
 */
export async function adjustStock(productId: string, delta: number) {
  return api.products.adjustStock(productId, delta);
}

/** Sets an exact count as a delta from the on-hand value the user saw. */
export async function setOnHand(productId: string, seenOnHand: number, nextOnHand: number) {
  const delta = Math.round(nextOnHand) - seenOnHand;
  if (delta === 0) return null;
  return api.products.adjustStock(productId, delta);
}

export async function deleteProduct(productId: string) {
  return api.products.remove(productId);
}

export async function saveCategory(id: string, values: CategoryInput) {
  return api.categories.save(id, values);
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>) {
  return api.categories.update(id, patch);
}

export async function deleteCategory(id: string) {
  return api.categories.remove(id);
}

/**
 * Saves the whole order at once. Sending the full id list (not a swap of two sortOrder values)
 * cannot misplace a category when two share a sortOrder (review: correctness #1).
 */
export async function saveCategoryOrder(orderedIds: readonly string[]) {
  return api.categories.reorder(orderedIds);
}
