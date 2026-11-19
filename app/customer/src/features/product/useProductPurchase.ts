import { MAX_CART_LINES, MAX_QUANTITY_PER_LINE, priceCart, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';

import { useCart } from '@/features/cart/CartProvider';
import { useToast } from '@/features/notifications/ToastProvider';

import { isAvailable } from './constants';

/** What the pinned button does right now. */
export type PurchaseAction = 'unavailable' | 'add' | 'update' | 'remove' | 'view';

export interface ProductPurchase {
  /** Quantity chosen on the stepper. */
  quantity: number;
  setQuantity: (quantity: number) => void;
  min: number;
  max: number;
  /** Quantity of this product already in the cart. */
  inCart: number;
  available: boolean;
  action: PurchaseAction;
  /** Catalogue price × quantity (the server re-prices at checkout). */
  lineTotal: number;
  commit: () => void;
}

/**
 * Quantity picker + cart action for the product page. Until the shopper touches the stepper it
 * mirrors the cart (or 1), so "Add to cart" adds the chosen quantity and later visits offer
 * "Update cart" / "In cart: n".
 */
export function useProductPurchase(product: Product): ProductPurchase {
  const cart = useCart();
  const toast = useToast();
  const [picked, setPicked] = useState<number | null>(null);

  const inCart = cart.quantityOf(product.id);
  const available = isAvailable(product);
  const max = available ? Math.min(MAX_QUANTITY_PER_LINE, product.stock) : 0;
  // Once it is in the cart the stepper can go down to 0, which turns the button into "Remove".
  const min = inCart > 0 ? 0 : 1;
  const quantity = Math.max(min, Math.min(max, picked ?? (inCart > 0 ? inCart : 1)));

  let action: PurchaseAction;
  if (!available) action = 'unavailable';
  else if (inCart === 0) action = 'add';
  else if (quantity === 0) action = 'remove';
  else if (quantity !== inCart) action = 'update';
  else action = 'view';

  const commit = () => {
    switch (action) {
      case 'unavailable':
        return;
      case 'view':
        router.push('/cart');
        return;
      case 'remove':
        cart.remove(product.id);
        setPicked(null);
        toast({ title: 'Removed from cart', body: product.name, icon: 'trash-2' });
        return;
      case 'add':
      case 'update':
        if (action === 'add' && cart.lines.length >= MAX_CART_LINES) {
          toast({
            title: 'Your cart is full',
            body: 'Remove an item to add something new.',
            icon: 'alert-circle',
          });
          return;
        }
        cart.setQuantity(product.id, quantity);
        setPicked(null);
        toast({
          title: action === 'add' ? 'Added to cart' : 'Cart updated',
          body: `${quantity} × ${product.name} · Tap to view your cart`,
          icon: 'shopping-bag',
          onPress: () => router.push('/cart'),
        });
    }
  };

  return {
    quantity,
    setQuantity: setPicked,
    min,
    max,
    inCart,
    available,
    action,
    lineTotal: priceCart([{ price: product.price, quantity }]).subtotal,
    commit,
  };
}
