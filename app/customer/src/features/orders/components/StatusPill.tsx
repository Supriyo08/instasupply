import { ORDER_STATUS_META, type OrderStatus } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius } from '@/theme/tokens';

import { TONES, type Tone } from './order-ui';

/** Rounded status label with a coloured dot. */
export function StatusPill({ label, tone, size = 'md' }: { label: string; tone: Tone; size?: 'sm' | 'md' }) {
  const { fg, bg } = TONES[tone];
  return (
    <View style={[styles.pill, size === 'sm' ? styles.small : null, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text variant={size === 'sm' ? 'micro' : 'captionMedium'} numberOfLines={1} style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

/** Status pill coloured by ORDER_STATUS_META tone. */
export function OrderStatusPill({ status, size }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const meta = ORDER_STATUS_META[status];
  return <StatusPill label={meta.label} tone={meta.tone} size={size} />;
}

const styles = StyleSheet.create({
  dot: { borderRadius: 3, height: 6, width: 6 },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  small: { gap: 5, paddingHorizontal: 8, paddingVertical: 2 },
});
