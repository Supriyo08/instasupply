import {
  formatMoney,
  storeOrderCustomerLabel,
  type Issue,
  type StoreOrder,
  type StoreOrderSummary,
} from '@instasupply/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Divider, Icon, PromiseLabel, StatusPill, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { promiseInputOf, storeOrderPromise, storeOrderTimeline, storeOrderTone } from '../order-format';
import { CodeCard } from './CodeCard';
import { DriverRow } from './DriverRow';
import { DropOffPhoto } from './DropOffPhoto';
import { LiveDeliveryInfo } from './LiveDeliveryInfo';
import { StoreOrderActions } from './StoreOrderActions';
import { StoreOrderLines } from './StoreOrderLines';
import { Timeline } from './Timeline';

/**
 * One store's part of an order: status and promise, the timeline, the driver, the lines with their
 * shortages, the pickup PIN, the hand-off code, the drop-off photo and the actions.
 */
export function StoreOrderCard({
  storeOrder,
  summary,
  openIssue,
  now,
  onCancel,
  cancelling,
}: {
  storeOrder: StoreOrder;
  summary: StoreOrderSummary | null;
  openIssue: Issue | null;
  now: number;
  onCancel: (storeOrder: StoreOrder) => void;
  cancelling: boolean;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const label = storeOrderCustomerLabel(storeOrder);
  const promise = storeOrderPromise(promiseInputOf(storeOrder), now);
  const pickupCode = summary?.pickupCode ?? null;
  const token = summary?.trackingToken ?? null;
  const showPin = storeOrder.fulfilment === 'pickup' && storeOrder.status === 'ready' && pickupCode;
  const live = storeOrder.fulfilment === 'delivery' && storeOrder.status === 'out_for_delivery' && token;
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.letter}>
          <Text variant="heading" color="primaryDark">
            {storeOrder.letter}
          </Text>
        </View>
        <View style={styles.title}>
          <Text variant="heading" numberOfLines={1}>
            {storeOrder.storeName}
          </Text>
          <Text variant="caption" color="muted">
            {storeOrder.number} · {storeOrder.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'} ·{' '}
            {formatMoney(storeOrder.current.totalCents)}
          </Text>
        </View>
      </View>
      <StatusPill label={label} tone={storeOrderTone(storeOrder.status)} />
      <PromiseLabel promise={promise} />
      {storeOrder.status === 'rejected' || storeOrder.status === 'cancelled' ? (
        <Text variant="caption" color="muted">
          You won't be charged for these items.
        </Text>
      ) : null}

      {storeOrder.driver ? (
        <DriverRow name={storeOrder.driver.firstName} vehicle={storeOrder.driver.vehicleLabel || null} />
      ) : null}
      {live ? (
        <LiveDeliveryInfo token={token} attended={storeOrder.receiving === 'attended'} now={now} />
      ) : null}
      {showPin ? (
        <CodeCard
          icon="key"
          title="Pickup PIN"
          subtitle={`Show this PIN at the ${storeOrder.storeName} counter`}
          code={pickupCode}
          footnote={storeOrder.storeAddressLine}
        />
      ) : null}
      {storeOrder.fulfilment === 'pickup' && storeOrder.status !== 'picked_up' ? (
        <View style={styles.address} accessible>
          <Icon name="map-pin" size={14} color={colors.textMuted} />
          <Text variant="caption" color="muted" style={styles.flex}>
            {storeOrder.storeAddressLine}
          </Text>
        </View>
      ) : null}
      {storeOrder.status === 'delivered' ? <DropOffPhoto storeOrderId={storeOrder.id} now={now} /> : null}

      <Divider />
      <StoreOrderLines lines={storeOrder.lines} />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showSteps }}
        accessibilityLabel={showSteps ? 'Hide status history' : 'Show status history'}
        onPress={() => setShowSteps((value) => !value)}
        style={styles.toggle}
        hitSlop={6}
      >
        <Text variant="captionMedium" color="primaryDark">
          {showSteps ? 'Hide status history' : 'Status history'}
        </Text>
        <Icon name={showSteps ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primaryDark} />
      </Pressable>
      {showSteps ? <Timeline steps={storeOrderTimeline(storeOrder)} now={now} /> : null}

      <StoreOrderActions
        storeOrder={storeOrder}
        trackingToken={token}
        openIssue={openIssue}
        now={now}
        onCancel={onCancel}
        cancelling={cancelling}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  address: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs + 2 },
  card: { gap: spacing.md },
  flex: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  letter: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  title: { flex: 1 },
  toggle: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs },
});
