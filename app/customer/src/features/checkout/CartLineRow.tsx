import { MAX_LINE_QUANTITY, formatMoney } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton, QuantityStepper, StatusPill, Text } from '@/components/ui';
import type { CartGroupLine, CartWarning } from '@/features/cart/useCartPricing';
import { colors, spacing } from '@/theme/tokens';

import { ProductThumb } from './ProductThumb';

/** One cart line: art, name and size, unit price, the line total, a stepper and its stock warning. */
export function CartLineRow({
  entry,
  warning,
  onChange,
  onRemove,
}: {
  entry: CartGroupLine;
  warning: CartWarning | null;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const { product, line, available } = entry;
  const name = product?.name ?? 'Item no longer sold';
  const cap = product ? Math.min(MAX_LINE_QUANTITY, product.maxPerOrder ?? MAX_LINE_QUANTITY) : 0;
  const max = Math.max(line.quantity, Math.min(cap, available));
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${name}`}
        disabled={!product}
        onPress={() => product && router.push({ pathname: '/product/[id]', params: { id: product.id } })}
      >
        <ProductThumb product={product} />
      </Pressable>
      <View style={styles.body}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {name}
        </Text>
        {product?.size ? (
          <Text variant="caption" color="muted" numberOfLines={1}>
            {product.size}
          </Text>
        ) : null}
        {product ? (
          <Text variant="caption" color="muted">
            {formatMoney(product.priceCents)} / {product.unit}
          </Text>
        ) : null}
        {warning ? (
          <StatusPill
            label={warning.message}
            tone={warning.kind === 'only_left' ? 'warning' : 'danger'}
            size="sm"
          />
        ) : null}
        <View style={styles.controls}>
          {product ? (
            <QuantityStepper
              compact
              label={name}
              value={line.quantity}
              min={1}
              max={max}
              onChange={onChange}
            />
          ) : null}
          <Text variant="subheading" color="primaryDark" style={styles.total}>
            {product ? formatMoney(product.priceCents * line.quantity) : ''}
          </Text>
        </View>
      </View>
      <IconButton
        icon="trash-2"
        label={`Remove ${name}`}
        onPress={onRemove}
        color={colors.textMuted}
        size={32}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 2 },
  controls: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  total: { flex: 1, textAlign: 'right' },
});
