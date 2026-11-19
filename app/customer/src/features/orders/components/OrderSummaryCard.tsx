import { ORDER_STATUS_META, formatCurrency, formatDateTime, type Order } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { STATUS_ICONS, TONES, orderTitle } from './order-ui';

/** Top card of Track Order: number, placed date, items, total and a status banner. */
export function OrderSummaryCard({ order }: { order: Order }) {
  const meta = ORDER_STATUS_META[order.status];
  const tone = TONES[meta.tone];
  const description =
    order.status === 'cancelled' && order.cancelReason ? order.cancelReason : meta.description;

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.icon}>
          <Icon name="package" size={28} color={colors.primary} />
        </View>
        <View style={styles.info}>
          <Text variant="heading" numberOfLines={1}>
            {orderTitle(order)}
          </Text>
          <Text variant="caption" color="muted">
            Placed on {formatDateTime(order.createdAt)}
          </Text>
          <View style={styles.meta}>
            <Text variant="caption" color="muted">
              Items: <Text variant="captionMedium">{order.itemCount}</Text>
            </Text>
            <Text variant="caption" color="muted">
              Total:{' '}
              <Text variant="captionMedium" color="primaryDark">
                {formatCurrency(order.total)}
              </Text>
            </Text>
          </View>
        </View>
      </View>
      <View
        style={[styles.banner, { backgroundColor: tone.bg }]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Status: ${meta.label}. ${description}`}
      >
        <Icon name={STATUS_ICONS[order.status]} size={18} color={tone.fg} />
        <View style={styles.bannerText}>
          <Text variant="bodyMedium" style={{ color: tone.fg }}>
            {meta.label}
          </Text>
          <Text variant="caption" color="muted">
            {description}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bannerText: { flex: 1 },
  card: { overflow: 'hidden' },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  info: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', gap: spacing.lg, marginTop: 2 },
  top: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg, padding: spacing.lg },
});
