import type { PricedCart } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PriceSummary } from '@/components/catalog/PriceSummary';
import { Button, Skeleton, Text } from '@/components/ui';

/** White bottom panel of the cart: subtotal / shipping / total and the gradient Checkout button. */
export function CartFooter({
  priced,
  loading,
  canCheckout,
  blockedReason,
}: {
  priced: PricedCart;
  /** Prices have not arrived yet. */
  loading: boolean;
  canCheckout: boolean;
  /** Why checkout is disabled, when the shopper has something to fix. */
  blockedReason: string | null;
}) {
  return (
    <View style={styles.footer}>
      {loading ? (
        <View accessible accessibilityLabel="Loading prices" style={styles.loading}>
          <Skeleton style={styles.line} />
          <Skeleton style={styles.line} />
          <Skeleton style={styles.total} />
        </View>
      ) : (
        <PriceSummary priced={priced} />
      )}
      {blockedReason ? (
        <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
          {blockedReason}
        </Text>
      ) : null}
      <Button label="Checkout" disabled={!canCheckout} onPress={() => router.push('/checkout/address')} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 12 },
  line: { height: 12, width: '100%' },
  loading: { gap: 10 },
  total: { height: 18, width: '100%' },
});
