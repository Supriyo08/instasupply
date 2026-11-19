/**
 * Catalogue writes. Product writes must satisfy `isValidProduct` in the security rules, which checks
 * the whole resulting document (so partial updates are fine) and requires `updatedAt` to be the
 * server time. Only admins may delete products.
 */
import { buildSearchTerms, COLLECTIONS } from '@instasupply/shared';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/app';

import type { CategoryValues } from './category-form';
import type { ProductRecord } from './hooks';
import { sameTerms, slugCandidates, slugify, toStock, type ProductValues } from './product-form';

/** Firestore allows 500 writes per batch; stay well below it. */
const BATCH_LIMIT = 400;

const productRef = (id: string) => doc(db, COLLECTIONS.products, id);
const categoryRef = (id: string) => doc(db, COLLECTIONS.categories, id);

export type ProductUpdate = Partial<ProductValues> & { searchTerms?: string[] };

/** Set the shelf count to an exact number of units. */
export async function setProductStock(productId: string, stock: number): Promise<void> {
  await updateDoc(productRef(productId), { stock: toStock(stock), updatedAt: serverTimestamp() });
}

/**
 * Add or remove one unit as an atomic integer increment, so a sale checked out at the same moment is
 * never overwritten. The rules still reject a result below zero.
 */
export async function nudgeProductStock(productId: string, delta: 1 | -1): Promise<void> {
  await updateDoc(productRef(productId), { stock: increment(delta), updatedAt: serverTimestamp() });
}

export async function setProductFlag(
  productId: string,
  flag: 'active' | 'featured',
  value: boolean,
): Promise<void> {
  await updateDoc(productRef(productId), { [flag]: value, updatedAt: serverTimestamp() });
}

/**
 * Create a product under a readable id (the slugged name, then -2, -3… if taken). The transaction
 * re-checks the chosen id, so two people adding the same name can never overwrite each other.
 */
export async function createProduct(
  values: ProductValues,
  categoryName: string,
  knownIds: ReadonlySet<string>,
): Promise<string> {
  const base = slugify(values.name, 'product');
  return runTransaction(db, async (transaction) => {
    for (const id of slugCandidates(base, knownIds)) {
      const snapshot = await transaction.get(productRef(id));
      if (snapshot.exists()) continue;
      transaction.set(productRef(id), {
        ...values,
        rating: 0,
        ratingCount: 0,
        searchTerms: buildSearchTerms(values.name, [categoryName, values.unit]),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    }
    throw new Error("Couldn't find a free ID for this name. Make the name more specific.");
  });
}

export async function updateProduct(productId: string, changes: ProductUpdate): Promise<void> {
  await updateDoc(productRef(productId), { ...changes, updatedAt: serverTimestamp() });
}

/**
 * Delete a product and its reviews, so a future product that reuses the id doesn't inherit them.
 * The product is in the first batch: if it can't be deleted, nothing is.
 */
export async function deleteProduct(productId: string): Promise<void> {
  const reviews = await getDocs(collection(db, COLLECTIONS.products, productId, COLLECTIONS.reviews));
  const refs = reviews.docs.map((review) => review.ref);
  let start = 0;
  do {
    const batch = writeBatch(db);
    if (start === 0) batch.delete(productRef(productId));
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
    start += BATCH_LIMIT;
  } while (start < refs.length);
}

export async function createCategory(id: string, values: CategoryValues): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(categoryRef(id));
    if (snapshot.exists()) throw new Error(`A category with the ID "${id}" already exists.`);
    transaction.set(categoryRef(id), values);
  });
}

export async function updateCategory(id: string, changes: Partial<CategoryValues>): Promise<void> {
  await updateDoc(categoryRef(id), changes);
}

/**
 * Product search terms include the category name; re-index a renamed category's products so
 * shoppers can find them by the new name. Returns how many products changed.
 */
export async function refreshSearchTerms(
  products: readonly ProductRecord[],
  categoryName: string,
): Promise<number> {
  const stale = products
    .map((product) => ({ product, terms: buildSearchTerms(product.name, [categoryName, product.unit]) }))
    .filter(({ product, terms }) => !sameTerms(product.searchTerms, terms));
  for (let start = 0; start < stale.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const { product, terms } of stale.slice(start, start + BATCH_LIMIT)) {
      batch.update(productRef(product.id), { searchTerms: terms, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
  return stale.length;
}

/** Delete an empty category. Re-checks on the server that no product still uses it. */
export async function deleteCategory(id: string): Promise<void> {
  const inUse = await getDocs(
    query(collection(db, COLLECTIONS.products), where('categoryId', '==', id), limit(1)),
  );
  if (!inUse.empty) throw new Error('This category still has products. Move or delete them first.');
  await deleteDoc(categoryRef(id));
}

export async function saveCategoryOrder(
  updates: readonly { id: string; sortOrder: number }[],
): Promise<void> {
  const batch = writeBatch(db);
  for (const update of updates) batch.update(categoryRef(update.id), { sortOrder: update.sortOrder });
  await batch.commit();
}
