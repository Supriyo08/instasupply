import { priceCart, type PricedCart, type Product } from '@instasupply/shared';
import { useMemo } from 'react';

import { useProductsByIds } from '@/features/catalog/hooks';
import { useIsFirstOrder } from '@/features/orders/hooks';

import { useCart } from './CartProvider';

export interface CartItem {
  product: Product;
  quantity: number;
  /** Not orderable right now (inactive or out of stock). */
  unavailable: boolean;
  /** More requested than in stock. */
  limitedTo: number | null;
}

/**
 * The cart joined with live catalogue data and priced exactly like the server will.
 * If the products can't be loaded, `error` is set and `items` is empty. That says nothing about
 * what is still sold: show the error with `retry`, not the lines as missing or the totals as zero.
 */
export function useCartDetails(uid: string | undefined) {
  const cart = useCart();
  const ids = useMemo(() => cart.lines.map((line) => line.productId), [cart.lines]);
  const { data: products, loading, error, retry } = useProductsByIds(ids);
  const isFirstOrder = useIsFirstOrder(uid);

  return useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    const items: CartItem[] = [];
    for (const line of cart.lines) {
      const product = byId.get(line.productId);
      if (!product) continue;
      const unavailable = !product.active || product.stock <= 0;
      items.push({
        product,
        quantity: line.quantity,
        unavailable,
        limitedTo: !unavailable && product.stock < line.quantity ? product.stock : null,
      });
    }
    const orderable = items.filter((item) => !item.unavailable);
    const priced: PricedCart = priceCart(
      orderable.map((item) => ({ price: item.product.price, quantity: item.quantity })),
      { promoCode: cart.promoCode, isFirstOrder },
    );
    const missing = cart.lines.filter((line) => !byId.has(line.productId)).length;
    return {
      items,
      priced,
      loading,
      error,
      retry,
      canCheckout:
        !loading &&
        !error &&
        orderable.length > 0 &&
        items.every((item) => !item.unavailable && item.limitedTo == null) &&
        missing === 0,
      isFirstOrder,
    };
  }, [cart.lines, cart.promoCode, products, loading, error, retry, isFirstOrder]);
}
