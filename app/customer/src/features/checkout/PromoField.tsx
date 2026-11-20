import type { PricedCheckout } from '@instasupply/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Input, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { spacing } from '@/theme/tokens';

/**
 * Promo code with its status message from `priceCheckout` ("BUILD25 applied: $25.00 off", "Add
 * $120.00 more to use BUILD25", "Your first-order discount … applies instead"). The code is kept
 * in the cart; the server checks it again at checkout.
 */
export function PromoField({ promo, onFocus }: { promo: PricedCheckout['promo']; onFocus?: () => void }) {
  const cart = useCart();
  const [text, setText] = useState(cart.promoCode ?? '');
  useEffect(() => setText(cart.promoCode ?? ''), [cart.promoCode]);

  const applied = cart.promoCode != null;
  const tone =
    promo?.status === 'applied' ? 'primaryDark' : promo?.status === 'not_better' ? 'muted' : 'danger';
  return (
    <Card style={styles.card}>
      <Text variant="heading">Promo code</Text>
      <View style={styles.row}>
        <View style={styles.field}>
          <Input
            tone="muted"
            icon="tag"
            placeholder="Enter a code"
            value={text}
            onChangeText={(value) => setText(value.toUpperCase())}
            onFocus={onFocus}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            editable={!applied}
            returnKeyType="done"
            onSubmitEditing={() => cart.setPromoCode(text)}
            accessibilityLabel="Promo code"
          />
        </View>
        {applied ? (
          <Button
            label="Remove"
            variant="ghost"
            onPress={() => cart.setPromoCode(null)}
            style={styles.button}
          />
        ) : (
          <Button
            label="Apply"
            variant="secondary"
            disabled={!text.trim()}
            onPress={() => cart.setPromoCode(text)}
            style={styles.button}
          />
        )}
      </View>
      {promo ? (
        <Text variant="caption" color={tone} accessibilityLiveRegion="polite">
          {promo.message}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'auto', minWidth: 96 },
  card: { gap: spacing.sm },
  field: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
});
