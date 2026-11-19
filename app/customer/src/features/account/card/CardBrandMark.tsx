import type { CardBrand } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, fonts } from '@/theme/tokens';

import { CARD_BRAND_LABEL } from './card-format';

const WORDMARK: Partial<Record<CardBrand, string>> = { visa: 'VISA', amex: 'AMEX', rupay: 'RuPay' };

/**
 * Network mark drawn with views (no bitmap logos): overlapping circles for Mastercard, a
 * wordmark for Visa / Amex / RuPay and a card glyph otherwise. `light` is for the green card.
 */
export function CardBrandMark({
  brand,
  scale = 1,
  tone = 'light',
}: {
  brand: CardBrand;
  scale?: number;
  tone?: 'light' | 'dark';
}) {
  const fg = tone === 'light' ? colors.white : colors.text;
  if (brand === 'mastercard') {
    const size = Math.round(26 * scale);
    return (
      <View
        accessible
        accessibilityLabel={CARD_BRAND_LABEL.mastercard}
        style={{ width: Math.round(size * 1.6), height: size }}
      >
        <View
          style={[styles.circle, { width: size, height: size, borderRadius: size / 2, left: 0 }, styles.red]}
        />
        <View
          style={[
            styles.circle,
            { width: size, height: size, borderRadius: size / 2, right: 0 },
            styles.amber,
          ]}
        />
      </View>
    );
  }
  const word = WORDMARK[brand];
  if (!word)
    return <Icon name="credit-card" size={Math.round(24 * scale)} color={fg} accessibilityLabel="Card" />;
  return (
    <Text
      accessibilityLabel={CARD_BRAND_LABEL[brand]}
      style={[
        styles.word,
        { color: fg, fontSize: Math.round(18 * scale), lineHeight: Math.round(24 * scale) },
      ]}
    >
      {word}
    </Text>
  );
}

const styles = StyleSheet.create({
  amber: { backgroundColor: colors.star, opacity: 0.88 },
  circle: { position: 'absolute', top: 0 },
  red: { backgroundColor: colors.danger },
  word: { fontFamily: fonts.bold, fontStyle: 'italic', letterSpacing: 1 },
});
