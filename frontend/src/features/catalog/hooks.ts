import { COLLECTIONS, type Category, type Product } from '@instasupply/shared';
import { collection, orderBy, query } from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase/app';
import { useCollection, type WithId } from '@/lib/firebase/hooks';

export type ProductRecord = WithId<Product>;
export type CategoryRecord = WithId<Category>;

/**
 * Every product, A–Z. The catalogue is a few hundred documents, so one listener plus client-side
 * filtering beats a query (and a composite index) per filter combination.
 */
export function useProducts() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.products), orderBy('name')), []);
  return useCollection<Product>(q);
}

/** Categories in shop order. */
export function useCategories() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.categories), orderBy('sortOrder')), []);
  return useCollection<Category>(q);
}
