import { pluralize } from '@instasupply/shared';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorState, Header, IconButton, Notice, Screen, SectionHeader } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { useCartDetails, type CartItem } from '@/features/cart/useCartDetails';
import { CartFooter } from '@/features/checkout/CartFooter';
import { CartItemRow } from '@/features/checkout/CartItemRow';
import { EmptyCart, fillContent } from '@/features/checkout/EmptyCart';
import { FreeDeliveryProgress } from '@/features/checkout/FreeDeliveryProgress';
import { ScrollBody, scrollBodyContainer, useKeyboardReveal } from '@/features/checkout/KeyboardScroll';
import { PromoCodeSection } from '@/features/checkout/PromoCodeSection';
import { CartRowsSkeleton } from '@/features/checkout/Skeletons';
import { useToast } from '@/features/notifications/ToastProvider';
import { useOrders } from '@/features/orders/hooks';
import { useCustomer } from '@/features/session/SessionProvider';
import { confirmAction } from '@/lib/notify';
import { colors } from '@/theme/tokens';

export default function CartScreen() {
  const { user } = useCustomer();
  const cart = useCart();
  const { setQuantity } = cart;
  const toast = useToast();
  const { items, priced, loading, error, retry, canCheckout, isFirstOrder } = useCartDetails(user.uid);
  // Same query as the first-order check: only offer FIRST20 once the order history has loaded.
  const orders = useOrders(user.uid, 20);
  const keyboard = useKeyboardReveal();

  /** Cart lines whose product no longer exists in the catalogue (they have no row to show). */
  const missingIds = useMemo(() => {
    // Until the products have loaded (or if they couldn't be), no line is known to be gone.
    if (loading || error) return [];
    const present = new Set(items.map((item) => item.product.id));
    return cart.lines.filter((line) => !present.has(line.productId)).map((line) => line.productId);
  }, [loading, error, items, cart.lines]);

  const removeItem = useCallback(
    (item: CartItem) => {
      setQuantity(item.product.id, 0);
      toast({
        title: `Removed ${item.product.name}`,
        body: 'Tap to undo',
        icon: 'trash-2',
        onPress: () => setQuantity(item.product.id, item.quantity),
      });
    },
    [setQuantity, toast],
  );

  const clearCart = async () => {
    const confirmed = await confirmAction(
      'Clear your cart?',
      'All items and any promo code will be removed.',
      'Clear cart',
    );
    if (confirmed) cart.clear();
  };

  const header = (
    <Header
      title="Shopping Cart"
      right={
        cart.lines.length > 0 ? (
          <IconButton
            icon="trash-2"
            label="Clear cart"
            color={colors.textMuted}
            onPress={() => void clearCart()}
          />
        ) : undefined
      }
    />
  );

  if (cart.lines.length === 0) {
    return (
      <Screen header={header} contentStyle={fillContent}>
        <EmptyCart />
      </Screen>
    );
  }

  // The products couldn't be loaded, so there are no rows or prices to show and nothing to remove:
  // only a way to try again. (The header can still clear the cart.)
  if (error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your cart" error={error} onRetry={retry} />
      </Screen>
    );
  }

  const initialLoading = loading && items.length === 0;
  const hasUnavailable = missingIds.length > 0 || items.some((item) => item.unavailable);
  const hasLimited = items.some((item) => item.limitedTo != null);
  const blockedReason = loading
    ? null
    : hasUnavailable
      ? 'Remove the unavailable items to check out.'
      : hasLimited
        ? 'Lower the quantities marked above to check out.'
        : null;

  return (
    <Screen
      header={header}
      scroll={false}
      contentStyle={scrollBodyContainer}
      footer={
        <CartFooter
          priced={priced}
          loading={initialLoading}
          canCheckout={canCheckout}
          blockedReason={blockedReason}
        />
      }
    >
      <ScrollBody ref={keyboard.scrollRef}>
        {missingIds.length > 0 ? (
          <Notice
            tone="danger"
            title={`${pluralize(missingIds.length, 'item')} no longer sold`}
            message="These products were removed from the store, so we can't deliver them."
            actionLabel="Remove"
            onAction={() => missingIds.forEach((id) => setQuantity(id, 0))}
          />
        ) : null}

        {!initialLoading && priced.subtotal > 0 ? <FreeDeliveryProgress priced={priced} /> : null}

        {initialLoading ? (
          <CartRowsSkeleton count={Math.min(cart.lines.length, 4)} />
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <CartItemRow
                key={item.product.id}
                item={item}
                onQuantityChange={setQuantity}
                onRemove={removeItem}
              />
            ))}
          </View>
        )}

        <View style={styles.section} onLayout={keyboard.track('promo')}>
          <SectionHeader title="Promo code" />
          <PromoCodeSection
            promoCode={cart.promoCode}
            priced={priced}
            checking={initialLoading}
            showFirstOrderHint={isFirstOrder && !orders.loading && !orders.error}
            onApply={cart.setPromoCode}
            onRemove={() => cart.setPromoCode(null)}
            onInputFocus={() => keyboard.reveal('promo')}
          />
        </View>
      </ScrollBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  section: { gap: 10 },
});
