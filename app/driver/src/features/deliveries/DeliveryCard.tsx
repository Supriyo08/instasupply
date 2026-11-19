import { formatClock, formatCurrency, formatDistance, type Delivery } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, StatusBadge, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PlannedStop } from './hooks';

export function DeliveryTags({ delivery }: { delivery: Delivery }) {
  return (
    <View style={styles.tags}>
      <StatusBadge status={delivery.status} />
      {delivery.priority !== 'normal' ? (
        <Badge
          label={delivery.priority}
          tone={delivery.priority === 'urgent' ? 'danger' : 'warning'}
          icon="flash"
        />
      ) : null}
      {delivery.codAmount ? (
        <Badge label={`COD ${formatCurrency(delivery.codAmount)}`} tone="warning" icon="cash" />
      ) : null}
      {delivery.requireCode ? <Badge label="Code" tone="info" icon="key" /> : null}
      {delivery.packageCount > 1 ? <Badge label={`${delivery.packageCount} pkgs`} icon="cube" /> : null}
    </View>
  );
}

export function DeliveryCard({ stop, onPress }: { stop: PlannedStop; onPress: () => void }) {
  const { colors } = useTheme();
  const { delivery, plan, etaAt, sequence } = stop;
  return (
    <Card onPress={onPress} accessibilityLabel={`Stop ${sequence}, ${delivery.customer.name}`}>
      <View style={styles.row}>
        <View style={[styles.sequence, { backgroundColor: colors.primarySoft }]}>
          <Text variant="bodyStrong" color="primary">
            {sequence}
          </Text>
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {delivery.customer.name}
            </Text>
            {etaAt ? (
              <Text variant="caption" color="primary">
                ETA {formatClock(etaAt)}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" color="muted" numberOfLines={2}>
            {delivery.address}
          </Text>
          {plan ? (
            <View style={styles.meta}>
              <Icon name="car-outline" size={14} color={colors.textSubtle} />
              <Text variant="caption" color="subtle">
                {formatDistance(plan.legMeters)} from previous stop · {delivery.orderId}
              </Text>
            </View>
          ) : (
            <Text variant="caption" color="subtle">
              {delivery.orderId}
            </Text>
          )}
          <DeliveryTags delivery={delivery} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 6 },
  flex: { flex: 1 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
  sequence: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
