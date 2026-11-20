import { describeError, queries } from '@instasupply/api-client';
import { MAX_LINE_QUANTITY, type CartLine, type Order, type StoreOrder } from '@instasupply/shared';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { useCart } from '@/features/cart/CartProvider';
import { resetCheckoutDraft, updateCheckoutDraft } from '@/features/checkout/checkout-draft';
import { api } from '@/lib/api';
import { confirmAction, notify } from '@/lib/notify';

/**
 * The cart lines of a past order: every catalogue line, at the quantity ordered, one line per product.
 * Special-order lines from a quote are not in the catalogue and cannot be reordered.
 */
export function reorderLines(storeOrders: readonly StoreOrder[]): CartLine[] {
  const byProduct = new Map<string, CartLine>();
  for (const storeOrder of storeOrders) {
    for (const line of storeOrder.lines) {
      if (line.kind !== 'catalog' || !line.productId) continue;
      const existing = byProduct.get(line.productId);
      const quantity = Math.min(MAX_LINE_QUANTITY, (existing?.quantity ?? 0) + line.quantity);
      byProduct.set(line.productId, { productId: line.productId, storeId: storeOrder.storeId, quantity });
    }
  }
  return [...byProduct.values()];
}

/**
 * Reorder (MARKETPLACE §7.3): fills the cart from the order's store-order lines and opens the cart,
 * or with `checkout` goes straight to checkout with the same jobsite, ASAP and the default card.
 * Asks first when the cart already holds something. Prices and stock are checked again in the cart.
 */
export function useReorder() {
  const cart = useCart();
  const [busyId, setBusyId] = useState<string | null>(null);

  const reorder = useCallback(
    async (
      order: Pick<Order, 'id' | 'number' | 'fulfilment' | 'jobsite'>,
      options: { checkout?: boolean; storeOrders?: readonly StoreOrder[] } = {},
    ) => {
      if (busyId) return;
      setBusyId(order.id);
      try {
        const storeOrders =
          options.storeOrders ?? (await api.cache.prefetch(queries.orderStoreOrders(order.id)));
        const lines = reorderLines(storeOrders);
        if (lines.length === 0) {
          notify('Nothing to reorder', `${order.number} has no catalogue items left to add to your cart.`);
          return;
        }
        if (cart.count > 0) {
          const replace = await confirmAction(
            'Replace your cart?',
            `Your cart will be emptied and filled with the items of ${order.number}.`,
            'Replace cart',
          );
          if (!replace) return;
        }
        cart.replace(lines);
        if (options.checkout) {
          cart.setFulfilment(order.fulfilment);
          resetCheckoutDraft();
          updateCheckoutDraft({
            jobsiteId: order.jobsite?.jobsiteId ?? null,
            windowId: 'asap',
            cardId: null,
          });
          router.push('/checkout');
        } else {
          router.push('/cart');
        }
      } catch (error) {
        notify("Couldn't reorder", describeError(error));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, cart],
  );

  return { reorder, busyId };
}
