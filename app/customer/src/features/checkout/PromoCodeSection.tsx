import { PROMOS, formatCurrency, type PricedCart } from '@instasupply/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Input, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

const FIRST_ORDER_PROMO = PROMOS.FIRST20;

/**
 * Promo code entry for the cart. Once a code is set it shows whether it applies ("FIRST20 applied ·
 * You save ₹40") or why not (`priced.promoError`), with a way to remove it.
 */
export function PromoCodeSection({
  promoCode,
  priced,
  checking,
  showFirstOrderHint,
  onApply,
  onRemove,
  onInputFocus,
}: {
  promoCode: string | null;
  priced: PricedCart;
  /** Prices are still loading, so the code can't be judged yet. */
  checking: boolean;
  showFirstOrderHint: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
  /** Lets the screen scroll the field above the keyboard. */
  onInputFocus?: () => void;
}) {
  const [draft, setDraft] = useState('');

  if (promoCode) {
    const applied = priced.promo != null;
    const status = checking
      ? 'Checking your code…'
      : applied
        ? `You save ${formatCurrency(priced.discount)}`
        : priced.promoError;
    return (
      <View
        style={[styles.applied, { borderColor: checking || applied ? colors.primaryLight : colors.danger }]}
      >
        <View
          style={[
            styles.badge,
            { backgroundColor: checking || applied ? colors.primarySoft : colors.dangerSoft },
          ]}
        >
          <Icon
            name={checking ? 'tag' : applied ? 'check' : 'alert-circle'}
            size={16}
            color={checking || applied ? colors.primary : colors.danger}
          />
        </View>
        <View style={styles.copy} accessibilityLiveRegion="polite">
          <Text variant="bodyMedium">{applied ? `${promoCode} applied` : promoCode}</Text>
          {status ? (
            <Text variant="caption" color={checking ? 'muted' : applied ? 'primaryDark' : 'danger'}>
              {status}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove promo code ${promoCode}`}
          hitSlop={10}
          onPress={onRemove}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="captionMedium" color="danger">
            Remove
          </Text>
        </Pressable>
      </View>
    );
  }

  const apply = () => {
    const code = draft.trim();
    if (!code) return;
    onApply(code);
    setDraft('');
  };

  return (
    <View style={styles.entry}>
      <Input
        icon="tag"
        placeholder="Enter promo code"
        value={draft}
        onChangeText={(text) => setDraft(text.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={20}
        returnKeyType="done"
        onSubmitEditing={apply}
        onFocus={onInputFocus}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Apply promo code"
            accessibilityState={{ disabled: !draft.trim() }}
            disabled={!draft.trim()}
            hitSlop={10}
            onPress={apply}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="bodyMedium" color={draft.trim() ? 'primary' : 'subtle'}>
              Apply
            </Text>
          </Pressable>
        }
      />
      {showFirstOrderHint && FIRST_ORDER_PROMO ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Apply ${FIRST_ORDER_PROMO.code}: ${FIRST_ORDER_PROMO.label}`}
          onPress={() => onApply(FIRST_ORDER_PROMO.code)}
          style={({ pressed }) => [styles.hint, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Icon name="gift" size={16} color={colors.primary} />
          <View style={styles.copy}>
            <Text variant="captionMedium">
              First order? Use{' '}
              <Text variant="captionMedium" color="primary">
                {FIRST_ORDER_PROMO.code}
              </Text>
            </Text>
            <Text variant="caption" color="muted">
              {FIRST_ORDER_PROMO.label}
            </Text>
          </View>
          <Text variant="captionMedium" color="primary">
            Apply
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  applied: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  badge: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  copy: { flex: 1 },
  entry: { gap: 10 },
  hint: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
