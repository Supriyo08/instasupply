import { isFutureExpiry, type CardBrand, type SavedCard } from '@instasupply/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, gradient, radius } from '@/theme/tokens';

export const CARD_WIDTH = 236;
export const CARD_HEIGHT = 144;

const BRAND_NAMES: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  rupay: 'RuPay',
  amex: 'American Express',
  card: 'Card',
};

export const isCardUsable = (card: SavedCard) => isFutureExpiry(card.expMonth, card.expYear);

export function cardExpiry(card: SavedCard) {
  return `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear % 100).padStart(2, '0')}`;
}

function BrandMark({ brand }: { brand: CardBrand }) {
  if (brand === 'mastercard') {
    return (
      <View
        style={styles.mastercard}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.disc, { backgroundColor: colors.danger }]} />
        <View style={[styles.disc, styles.discOverlap, { backgroundColor: colors.star }]} />
      </View>
    );
  }
  if (brand === 'card') return <Icon name="credit-card" size={22} color={colors.white} />;
  return (
    <Text variant="heading" color="white" style={styles.wordmark}>
      {brand === 'visa' ? 'VISA' : brand === 'amex' ? 'AMEX' : 'RuPay'}
    </Text>
  );
}

/** Mini version of the Big Cart green credit card, selectable like a radio. */
export const CardOption = memo(function CardOption({
  card,
  selected,
  onSelect,
}: {
  card: SavedCard;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const usable = isCardUsable(card);
  const expiry = cardExpiry(card);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !usable }}
      accessibilityLabel={`${BRAND_NAMES[card.brand]} ending in ${card.last4}, ${usable ? 'expires' : 'expired'} ${expiry}`}
      disabled={!usable}
      onPress={() => onSelect(card.id)}
      style={({ pressed }) => [
        styles.frame,
        {
          borderColor: selected ? colors.primary : 'transparent',
          opacity: !usable ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <LinearGradient colors={gradient.colors} start={gradient.start} end={gradient.end} style={styles.card}>
        <View style={[styles.bubble, styles.bubbleLarge]} />
        <View style={[styles.bubble, styles.bubbleSmall]} />
        <View style={styles.top}>
          <BrandMark brand={card.brand} />
          <View style={[styles.radio, selected ? styles.radioOn : null]}>
            {selected ? <Icon name="check" size={12} color={colors.primary} /> : null}
          </View>
        </View>
        <Text variant="bodyMedium" color="white" style={styles.number}>
          •••• •••• •••• {card.last4}
        </Text>
        <View style={styles.bottom}>
          <View style={styles.holder}>
            <Text variant="micro" color="white" style={styles.caps}>
              Card holder
            </Text>
            <Text variant="captionMedium" color="white" numberOfLines={1}>
              {card.holder}
            </Text>
          </View>
          <View style={styles.expiry}>
            <Text variant="micro" color="white" style={styles.caps}>
              {usable ? 'Expires' : 'Expired'}
            </Text>
            <Text variant="captionMedium" color="white">
              {expiry}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  bottom: { alignItems: 'flex-end', flexDirection: 'row', gap: 12 },
  bubble: { backgroundColor: colors.white, borderRadius: radius.pill, opacity: 0.16, position: 'absolute' },
  bubbleLarge: { height: 120, right: -40, top: -50, width: 120 },
  bubbleSmall: { height: 56, right: 46, top: -24, width: 56 },
  caps: { letterSpacing: 0.6, opacity: 0.85, textTransform: 'uppercase' },
  card: {
    borderRadius: radius.lg,
    height: CARD_HEIGHT,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: 16,
    width: CARD_WIDTH,
  },
  disc: { borderRadius: 12, height: 24, width: 24 },
  discOverlap: { marginLeft: -9, opacity: 0.9 },
  expiry: { alignItems: 'flex-end' },
  frame: { borderRadius: radius.lg + 3, borderWidth: 2, padding: 2 },
  holder: { flex: 1 },
  mastercard: { flexDirection: 'row' },
  number: { letterSpacing: 1.2 },
  radio: {
    alignItems: 'center',
    borderColor: colors.white,
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  radioOn: { backgroundColor: colors.white },
  top: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: { letterSpacing: 1.5 },
});
