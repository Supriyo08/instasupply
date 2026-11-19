import { MAX_CART_LINES, pluralize, type Product } from '@instasupply/shared';
import { router } from 'expo-router';

import { Button } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { useToast } from '@/features/notifications/ToastProvider';

import { isAvailable } from './constants';

/**
 * Pinned gradient button of the favourites screen: adds one of every available favourite that
 * isn't in the cart yet; once everything is in, it becomes "View cart".
 */
export function AddAllToCart({ products }: { products: readonly Product[] }) {
  const cart = useCart();
  const toast = useToast();
  const addable = products.filter((product) => isAvailable(product) && cart.quantityOf(product.id) === 0);
  const someInCart = products.some((product) => cart.quantityOf(product.id) > 0);

  if (addable.length === 0 && someInCart) {
    return <Button label="View cart" trailingIcon="arrow-right" onPress={() => router.push('/cart')} />;
  }

  const addAll = () => {
    const room = Math.max(0, MAX_CART_LINES - cart.lines.length);
    const batch = addable.slice(0, room);
    batch.forEach((product) => cart.add(product.id));
    const full = batch.length < addable.length;
    toast({
      title: full ? 'Your cart is full' : `Added ${pluralize(batch.length, 'item')} to your cart`,
      body: full
        ? `Added ${pluralize(batch.length, 'item')}. Remove something to add the rest.`
        : 'Tap to view your cart',
      icon: full ? 'alert-circle' : 'shopping-bag',
      onPress: () => router.push('/cart'),
    });
  };

  return (
    <Button
      label={someInCart ? `Add ${addable.length} more to cart` : 'Add all to cart'}
      trailingIcon="shopping-bag"
      disabled={addable.length === 0}
      onPress={addAll}
    />
  );
}
