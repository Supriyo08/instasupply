import { useLiveDoc, useLiveQuery, type LiveResult } from '@instasupply/expo-firebase';
import { COLLECTIONS, searchKeyFor, type Category, type Product, type Review } from '@instasupply/shared';
import { collection, doc, documentId, limit, orderBy, query, where } from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase';

const products = () => collection(db, COLLECTIONS.products);

export function useCategories() {
  const categoriesQuery = useMemo(
    () => query(collection(db, COLLECTIONS.categories), orderBy('sortOrder')),
    [],
  );
  return useLiveQuery<Category>(categoriesQuery, 'categories');
}

export function useCategory(id: string | undefined) {
  const ref = useMemo(() => (id ? doc(db, COLLECTIONS.categories, id) : null), [id]);
  return useLiveDoc<Category>(ref, `category:${id}`);
}

export function useFeaturedProducts(max = 12) {
  const featured = useMemo(
    () =>
      query(
        products(),
        where('active', '==', true),
        where('featured', '==', true),
        orderBy('name'),
        limit(max),
      ),
    [max],
  );
  return useLiveQuery<Product>(featured, `featured:${max}`);
}

export function useCategoryProducts(categoryId: string | undefined) {
  const byCategory = useMemo(
    () =>
      categoryId
        ? query(
            products(),
            where('categoryId', '==', categoryId),
            where('active', '==', true),
            orderBy('name'),
          )
        : null,
    [categoryId],
  );
  return useLiveQuery<Product>(byCategory, `category-products:${categoryId}`);
}

export function useProduct(id: string | undefined) {
  const ref = useMemo(() => (id ? doc(db, COLLECTIONS.products, id) : null), [id]);
  return useLiveDoc<Product>(ref, `product:${id}`);
}

/** Prefix search over product names/categories; extra words narrow the results client-side. */
export function useProductSearch(text: string) {
  const key = searchKeyFor(text);
  const searchQuery = useMemo(
    () =>
      key
        ? query(
            products(),
            where('active', '==', true),
            where('searchTerms', 'array-contains', key),
            limit(40),
          )
        : null,
    [key],
  );
  const result = useLiveQuery<Product>(searchQuery, `search:${key}`);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);
  const data = result.data.filter((product) =>
    words.every((word) => product.searchTerms.includes(word.slice(0, 15))),
  );
  return { ...result, data };
}

/** Firestore's cap on the values of one `in` filter. */
const IN_LIMIT = 30;

/**
 * Live products for a set of ids (cart, favorites, orders), in no particular order.
 * `data` only ever holds products that were asked for: when `ids` changes, the ones already loaded
 * stay (so lists don't flash) and `loading` is true from that render until the new set has answered.
 */
export function useProductsByIds(ids: readonly string[]): LiveResult<Product[]> {
  const key = [...new Set(ids)].sort().join(',');
  const chunks = useMemo(() => {
    const unique = key ? key.split(',') : [];
    const queries = [];
    for (let index = 0; index < unique.length; index += IN_LIMIT) {
      queries.push(query(products(), where(documentId(), 'in', unique.slice(index, index + IN_LIMIT))));
    }
    return queries;
  }, [key]);
  const result = useLiveQuery<Product>(chunks, `products:${key}`);

  return useMemo(() => {
    if (!result.loading) return result;
    const wanted = new Set(key.split(','));
    return { ...result, data: result.data.filter((product) => wanted.has(product.id)) };
  }, [result, key]);
}

export function useReviews(productId: string | undefined, max = 30) {
  const reviewsQuery = useMemo(
    () =>
      productId
        ? query(
            collection(db, COLLECTIONS.products, productId, COLLECTIONS.reviews),
            orderBy('updatedAt', 'desc'),
            limit(max),
          )
        : null,
    [productId, max],
  );
  return useLiveQuery<Review>(reviewsQuery, `reviews:${productId}:${max}`);
}

export function useMyReview(productId: string | undefined, uid: string | undefined) {
  const ref = useMemo(
    () => (productId && uid ? doc(db, COLLECTIONS.products, productId, COLLECTIONS.reviews, uid) : null),
    [productId, uid],
  );
  return useLiveDoc<Review>(ref, `my-review:${productId}:${uid}`);
}
