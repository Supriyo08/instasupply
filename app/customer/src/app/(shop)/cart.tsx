import { formatMoney, pluralize } from '@instasupply/shared';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ErrorState, Header, Notice, Screen, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { useCartPricing } from '@/features/cart/useCartPricing';
import { AmountRows } from '@/features/checkout/AmountRows';
import { CartPerks } from '@/features/checkout/CartPerks';
import { CartStoreSection } from '@/features/checkout/CartStoreSection';
import { EmptyCart, fillContent } from '@/features/checkout/EmptyCart';
import { FulfilmentBar } from '@/features/checkout/FulfilmentBar';
import { PromoField } from '@/features/checkout/PromoField';
import { CartRowsSkeleton } from '@/features/checkout/Skeletons';
import { useToast } from '@/features/notifications/ToastProvider';
import { useIsFirstOrder } from '@/features/orders/hooks';
import { goToSignIn } from '@/features/session/RequireAccount';
import { useUid } from '@/features/session/SessionProvider';
import { confirmAction } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

/**
 * The cart, grouped by store (MARKETPLACE §7.3): each store's lines, load, fee preview and warnings,
 * the order-level perks, promo code and totals. Guests can fill it; Checkout asks them to sign in.
 */
export default function CartScreen() {
  const uid = useUid();
  const cart = useCart();
  const { groups, pricing, warnings, loading, error, retry } = useCartPricing();
  const firstOrder = useIsFirstOrder();
  const toast = useToast();
  const delivery = cart.fulfilment === 'delivery';

  const removeLine = useCallback(
    (productId: string) => {
      const line = cart.lines.find((item) => item.productId === productId);
      if (!line) return;
      cart.remove(productId);
      toast({
        title: 'Removed from your cart',
        body: 'Tap to undo',
        icon: 'trash-2',
        onPress: () => cart.setQuantity({ id: line.productId, storeId: line.storeId }, line.quantity),
      });
    },
    [cart, toast],
  );

  const clearCart = async () => {
    const confirmed = await confirmAction(
      'Clear your cart?',
      'Every item from every store and your promo code will be removed.',
      'Clear cart',
    );
    if (confirmed) cart.clear();
  };

  const header = (
    <Header
      title="Cart"
      right={
        cart.lines.length > 0 ? (
          <Button label="Clear" variant="ghost" onPress={() => void clearCart()} style={styles.clear} />
        ) : null
      }
    />
  );

  if (!cart.ready || (loading && cart.lines.length > 0)) {
    return (
      <Screen header={header}>
        <CartRowsSkeleton />
      </Screen>
    );
  }
  if (cart.lines.length === 0) {
    return (
      <Screen header={header} contentStyle={fillContent}>
        <EmptyCart />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load your cart" error={error} onRetry={retry} />
      </Screen>
    );
  }

  const stockProblem = warnings.some((warning) => warning.kind !== 'pricing');
  const orderWarnings = warnings.filter(
    (warning) => warning.kind === 'pricing' && warning.storeId == null && warning.code !== 'no_dropoff',
  );
  const needsSite =
    delivery && warnings.some((warning) => warning.kind === 'pricing' && warning.code === 'no_dropoff');
  const canContinue = pricing != null && !stockProblem;
  const deliveryList = pricing?.stores.reduce((sum, store) => sum + store.deliveryFeeListCents, 0) ?? null;

  const checkout = () => {
    if (!uid) goToSignIn('/checkout');
    else router.push('/checkout');
  };

  return (
    <Screen
      header={header}
      footer={
        <>
          {stockProblem ? (
            <Text variant="caption" color="danger" align="center">
              Fix the items marked in red to check out.
            </Text>
          ) : null}
          <Button
            label={pricing ? `Checkout · ${formatMoney(pricing.totalCents)}` : 'Checkout'}
            trailingIcon="arrow-right"
            disabled={!canContinue}
            onPress={checkout}
          />
        </>
      }
    >
      <FulfilmentBar />
      {needsSite ? (
        <Notice
          tone="info"
          icon="map-pin"
          message="Choose your jobsite to see delivery fees and times."
          actionLabel="Choose"
          onAction={() => router.push('/site')}
        />
      ) : null}
      {orderWarnings.map((warning, index) => (
        <Notice key={index} tone="danger" message={warning.message} />
      ))}

      <Text variant="caption" color="muted">
        {pluralize(cart.count, 'item')} from {pluralize(groups.length, 'store')}
      </Text>
      <View style={styles.groups}>
        {groups.map((group) => (
          <CartStoreSection key={group.storeId} group={group} onRemoveLine={removeLine} />
        ))}
      </View>

      {pricing ? <CartPerks pricing={pricing} firstOrder={firstOrder} delivery={delivery} /> : null}
      <PromoField promo={pricing?.promo ?? null} />
      {pricing ? (
        <Card style={styles.totals}>
          <Text variant="heading">Order summary</Text>
          <AmountRows
            amounts={pricing}
            delivery={delivery}
            deliveryListCents={deliveryList}
            discounts={pricing.discounts}
          />
          {!uid ? (
            <Text variant="caption" color="muted">
              First-order perks are confirmed when you sign in.
            </Text>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  clear: { alignSelf: 'auto', minWidth: 72 },
  groups: { gap: spacing.md },
  totals: { gap: spacing.md },
});
