import { formatDateTime, toMillis } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, EmptyState, Screen, StatusBadge, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { useDeliveryHistory } from '@/features/deliveries/hooks';

export default function HistoryScreen() {
  const { user } = useDriver();
  const { data, loading } = useDeliveryHistory(user.uid);

  return (
    <Screen edges={[]}>
      {!loading && data.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="No past deliveries"
          message="Completed and failed deliveries show up here."
        />
      ) : null}
      {data.map((delivery) => (
        <Card key={delivery.id} onPress={() => router.push(`/delivery/${delivery.id}`)}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{delivery.customer.name}</Text>
              <Text variant="caption" color="muted" numberOfLines={1}>
                {delivery.address}
              </Text>
              <Text variant="caption" color="subtle">
                {delivery.orderId} · {formatDateTime(toMillis(delivery.deliveredAt) ?? delivery.updatedAt)}
              </Text>
            </View>
            <StatusBadge status={delivery.status} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12 },
});
