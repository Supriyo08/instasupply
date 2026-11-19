import { formatCurrency, formatDistance } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PlannedStop } from './hooks';
import { useDeliveryAction } from './useDeliveryAction';

/** A newly assigned delivery waiting for the driver to accept or decline. */
export function AssignmentCard({ stop, onDecline }: { stop: PlannedStop; onDecline: (id: string) => void }) {
  const { colors } = useTheme();
  const { run, busyId } = useDeliveryAction();
  const { delivery, plan } = stop;
  const urgent = delivery.priority === 'urgent';

  return (
    <Card accent={urgent ? colors.danger : colors.warning}>
      <View style={styles.header}>
        <Text variant="micro" style={[styles.eyebrow, { color: urgent ? colors.danger : colors.warning }]}>
          {urgent ? 'Urgent · new delivery' : 'New delivery'}
        </Text>
        <Text
          variant="caption"
          color="primary"
          accessibilityRole="link"
          onPress={() => router.push(`/delivery/${delivery.id}`)}
        >
          {delivery.orderId} · Details
        </Text>
      </View>
      <Text variant="heading" style={styles.name}>
        {delivery.customer.name}
      </Text>
      <Text variant="caption" color="muted" numberOfLines={2}>
        {delivery.address}
      </Text>
      <Text variant="caption" color="subtle" style={styles.meta}>
        {[
          plan ? `${formatDistance(plan.legMeters)} away` : null,
          `${delivery.packageCount} package${delivery.packageCount === 1 ? '' : 's'}`,
          delivery.codAmount ? `Collect ${formatCurrency(delivery.codAmount)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button label="Decline" variant="secondary" onPress={() => onDecline(delivery.id)} />
        </View>
        <View style={styles.flex}>
          <Button
            label="Accept"
            icon="checkmark"
            loading={busyId === delivery.id}
            onPress={() => void run(delivery.id, 'accepted')}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  eyebrow: { letterSpacing: 0.8, textTransform: 'uppercase' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { marginTop: 6 },
  name: { marginTop: 6 },
});
