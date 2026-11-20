import { formatDateTimeET, formatMoney, STATUS_META, toMillis, type Delivery } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, Screen, Skeleton, StatusBadge, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { useDeliveryHistory } from '@/features/deliveries/hooks';
import { useNow } from '@/lib/use-now';

/** Past deliveries, newest first (CLIENTS §4.6 history: `queries.driverHistory(uid)`, paged). */
export default function HistoryScreen() {
  const { user } = useDriver();
  const { items, loading, error, retry, hasMore, loadMore, loadingMore, refreshing } = useDeliveryHistory(
    user.uid,
  );
  const now = useNow();

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={retry}>
      {error ? <ErrorState error={error} onRetry={retry} title="Couldn't load your history" /> : null}
      {loading && items.length === 0 ? <HistorySkeleton /> : null}
      {!loading && !error && items.length === 0 ? (
        <>
          <SceneArt scene="scene-jobsite-delivery" height={160} />
          <EmptyState
            icon="time-outline"
            title="No finished jobs yet"
            message="Delivered and failed jobs show up here with their payout."
          />
        </>
      ) : null}
      {items.map((delivery) => (
        <HistoryCard
          key={delivery.id}
          delivery={delivery}
          now={now}
          onPress={() => router.push(`/delivery/${delivery.id}`)}
        />
      ))}
      {hasMore ? (
        <Button label="Show older jobs" variant="ghost" loading={loadingMore} onPress={loadMore} />
      ) : null}
    </Screen>
  );
}

function HistoryCard({ delivery, now, onPress }: { delivery: Delivery; now: number; onPress: () => void }) {
  const when =
    toMillis(delivery.deliveredAt ?? null) ??
    toMillis(delivery.failedAt ?? null) ??
    toMillis(delivery.cancelledAt ?? null) ??
    toMillis(delivery.updatedAt);
  const from = delivery.pickup?.storeName ?? null;
  const route = from ? `${from} → ${delivery.address}` : delivery.address;
  const pay = delivery.payout ? formatMoney(delivery.payout.totalCents) : null;
  const date = when !== null ? formatDateTimeET(when, now) : '';
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${delivery.orderId}, ${route}, ${STATUS_META[delivery.status].label}${pay ? `, ${pay}` : ''}, ${date}`}
    >
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {from ?? delivery.customer.name}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={2}>
            {from ? `→ ${delivery.address}` : delivery.address}
          </Text>
          <Text variant="caption" color="subtle">
            {delivery.orderId}
            {date ? ` · ${date}` : ''}
          </Text>
        </View>
        <View style={styles.side}>
          <StatusBadge status={delivery.status} />
          {pay && delivery.status === 'delivered' ? <Text variant="bodyStrong">{pay}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

function HistorySkeleton() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading your history">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} height={84} radius={16} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  side: { alignItems: 'flex-end', gap: 6 },
  skeleton: { gap: 12 },
});
