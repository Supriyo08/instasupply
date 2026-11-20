import { formatMoney, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { useCallback } from 'react';

import { useCart } from '@/features/cart/CartProvider';
import { useToast } from '@/features/notifications/ToastProvider';
import { notify } from '@/lib/notify';

/**
 * Adds to (or sets in) the device cart and says what happened: a toast that opens the cart, or why
 * the cart refused ("One order can include up to 5 stores").
 */
export function useAddToCart() {
  const cart = useCart();
  const toast = useToast();

  const report = useCallback(
    (product: Product, ok: boolean, message: string | null, quantity: number, quiet: boolean) => {
      if (!ok) {
        notify("Couldn't add to cart", message ?? 'Try again.');
        return false;
      }
      if (quiet) return true;
      toast({
        title: quantity > 0 ? 'Added to cart' : 'Removed from cart',
        body:
          quantity > 0
            ? `${quantity} × ${product.name} · ${formatMoney(product.priceCents * quantity)}`
            : product.name,
        icon: 'shopping-bag',
        onPress: () => router.push('/cart'),
      });
      return true;
    },
    [toast],
  );

  /** Adds `quantity` more of the product. */
  const add = useCallback(
    (product: Product, quantity = 1) => {
      const change = cart.add(product, quantity);
      const total = cart.quantityOf(product.id) + quantity;
      return report(product, change.ok, change.ok ? null : change.message, total, false);
    },
    [cart, report],
  );

  /** Makes the cart hold exactly `quantity` (0 removes the line); `quiet` skips the toast (steppers). */
  const set = useCallback(
    (product: Product, quantity: number, options?: { quiet?: boolean }) => {
      const change = cart.setQuantity(product, quantity);
      return report(product, change.ok, change.ok ? null : change.message, quantity, options?.quiet ?? false);
    },
    [cart, report],
  );

  return { add, set, quantityOf: cart.quantityOf };
}
