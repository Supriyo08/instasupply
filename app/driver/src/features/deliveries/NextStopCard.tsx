import { formatClock, formatDistance, formatDuration, primaryDriverAction } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, IconButton, Text } from '@/components/ui';
import { usePresence } from '@/features/location/PresenceProvider';
import { callPhone, openNavigation } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

import { DeliveryTags } from './DeliveryCard';
import type { PlannedStop } from './hooks';
import { useDeliveryAction } from './useDeliveryAction';

export function NextStopCard({ stop }: { stop: PlannedStop }) {
  const { colors } = useTheme();
  const { lastFix } = usePresence();
  const { run, busyId } = useDeliveryAction();
  const { delivery, plan, etaAt } = stop;
  const action = primaryDriverAction(delivery.status);

  const onPrimary = () => {
    if (!action) return;
    if (action.requiresProof) router.push(`/delivery/${delivery.id}/complete`);
    else void run(delivery.id, action.to);
  };

  return (
    <Card accent={colors.primary} style={styles.card}>
      <View style={styles.header}>
        <Text variant="micro" color="primary" style={styles.eyebrow}>
          {delivery.status === 'in_transit'
            ? 'Heading to'
            : delivery.status === 'arrived'
              ? 'You are at'
              : 'Next stop'}
        </Text>
        {etaAt ? (
          <Text variant="caption" color="primary">
            ETA {formatClock(etaAt)}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text variant="title" numberOfLines={1} onPress={() => router.push(`/delivery/${delivery.id}`)}>
          {delivery.customer.name}
        </Text>
        <Text color="muted">{delivery.address}</Text>
        {delivery.addressNotes ? (
          <Text variant="caption" color="subtle">
            {delivery.addressNotes}
          </Text>
        ) : null}
        {plan ? (
          <Text variant="caption" color="subtle">
            {formatDistance(plan.legMeters)} · about {formatDuration(plan.legSeconds)} · {delivery.orderId}
          </Text>
        ) : null}
        <DeliveryTags delivery={delivery} />
      </View>
      <View style={styles.actions}>
        <IconButton
          icon="navigate"
          label="Navigate"
          tone="primary"
          size={50}
          onPress={() => void openNavigation(delivery.location, { origin: lastFix })}
        />
        {delivery.customer.phone ? (
          <IconButton
            icon="call"
            label="Call customer"
            tone="success"
            size={50}
            onPress={() => void callPhone(delivery.customer.phone!)}
          />
        ) : null}
        <View style={styles.primary}>
          {action ? (
            <Button
              label={action.label}
              size="lg"
              icon={action.requiresProof ? 'checkmark-done' : 'arrow-forward'}
              loading={busyId === delivery.id}
              onPress={onPrimary}
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 14 },
  body: { gap: 6, marginTop: 6 },
  card: { paddingVertical: 18 },
  eyebrow: { letterSpacing: 0.8, textTransform: 'uppercase' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  primary: { flex: 1 },
});
