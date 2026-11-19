import type { PaymentMethod } from '@instasupply/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FilledIcon, Icon, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

const METHODS: { id: PaymentMethod; label: string; caption: string; icon: (color: string) => ReactNode }[] = [
  {
    id: 'cod',
    label: 'Cash on delivery',
    caption: 'Pay at your door',
    icon: (color) => <FilledIcon name="cash-outline" size={24} color={color} />,
  },
  {
    id: 'card',
    label: 'Card',
    caption: 'Credit or debit',
    icon: (color) => <Icon name="credit-card" size={22} color={color} />,
  },
];

/** Big Cart payment tiles: white squares with a line icon; the chosen one gets a green ring. */
export function PaymentMethodTiles({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Payment method" style={styles.row}>
      {METHODS.map((method) => {
        const selected = method.id === value;
        return (
          <Pressable
            key={method.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${method.label}, ${method.caption}`}
            onPress={() => onChange(method.id)}
            style={({ pressed }) => [
              styles.tile,
              { borderColor: selected ? colors.primary : colors.surface, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            {selected ? (
              <View style={styles.check}>
                <Icon name="check" size={11} color={colors.white} />
              </View>
            ) : null}
            <View
              style={[styles.icon, { backgroundColor: selected ? colors.primarySoft : colors.background }]}
            >
              {method.icon(selected ? colors.primary : colors.textMuted)}
            </View>
            <Text variant="captionMedium" align="center" numberOfLines={1}>
              {method.label}
            </Text>
            <Text variant="micro" color="muted" align="center" numberOfLines={1}>
              {method.caption}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  check: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 18,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginBottom: 4,
    width: 44,
  },
  row: { flexDirection: 'row', gap: 12 },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flex: 1,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
});
