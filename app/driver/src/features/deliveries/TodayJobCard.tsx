import { STATUS_META, formatClockET, primaryDriverAction, type Delivery } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Icon, Money, Text, type IconName } from '@/components/ui';
import { classLabel, windowText } from '@/features/jobs/format';
import { useTheme } from '@/theme/ThemeProvider';

import type { PlannedJob } from './hooks';

/** The store half of a job card: "Ready ✓", "Being prepared, ready by 12:50 pm", "Loaded". */
export function storeStatusText(delivery: Delivery): { text: string; done: boolean } {
  const pickup = delivery.pickup;
  if (!pickup) return { text: 'No store pickup', done: true };
  if (pickup.collectedAt != null)
    return { text: `Loaded at ${formatClockET(pickup.collectedAt)} ✓`, done: true };
  if (pickup.ready)
    return { text: pickup.arrivedAt != null ? 'Ready ✓ · you are at the counter' : 'Ready ✓', done: true };
  return { text: `Being prepared, ready by ${formatClockET(pickup.readyBy)}`, done: false };
}

/**
 * A job of the day as two stops (MARKETPLACE §10 Today): ① the store, ② the site. Assignments from
 * dispatch carry Accept and Decline; every other card opens the delivery.
 */
export function TodayJobCard({
  job,
  now,
  next,
  busy,
  onOpen,
  onAccept,
  onDecline,
}: {
  job: PlannedJob;
  now: number;
  /** This job holds the stop to work on next. */
  next: boolean;
  busy: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const { delivery, pickup, dropoff } = job;
  const assigned = delivery.status === 'assigned';
  const store = storeStatusText(delivery);
  const window = windowText(delivery.windowStart, delivery.windowEnd, now);
  const action = primaryDriverAction(delivery);
  const meta = STATUS_META[delivery.status];
  const label = [
    assigned ? 'New assignment from dispatch' : meta.label,
    delivery.pickup ? `Store: ${delivery.pickup.storeName}, ${store.text}` : null,
    `Site: ${delivery.address}, ${window}`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card
      onPress={assigned ? undefined : onOpen}
      accent={assigned ? colors.warning : next ? colors.primary : undefined}
      accessibilityLabel={assigned ? undefined : label}
    >
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text
            variant="micro"
            color={assigned ? 'warning' : next ? 'primary' : 'subtle'}
            style={styles.kicker}
          >
            {assigned ? 'New from dispatch' : next ? 'Up next' : meta.label}
          </Text>
          <Text variant="caption" color="subtle">
            {delivery.orderId}
            {delivery.vehicleClass ? ` · ${classLabel(delivery.vehicleClass)}` : ''}
          </Text>
        </View>
        {delivery.payout ? <Money cents={delivery.payout.totalCents} variant="heading" /> : null}
      </View>

      {delivery.pickup ? (
        <StopLine
          number={pickup?.sequence ?? 1}
          icon="storefront-outline"
          tone={colors.warning}
          title={delivery.pickup.storeName}
          detail={store.text}
          done={delivery.pickup.collectedAt != null}
          eta={delivery.pickup.arrivedAt == null ? (pickup?.etaAt ?? null) : null}
        />
      ) : null}
      {delivery.pickup ? <View style={[styles.rail, { backgroundColor: colors.border }]} /> : null}
      <StopLine
        number={dropoff.sequence}
        icon="construct-outline"
        tone={colors.primary}
        title={delivery.address}
        detail={`${delivery.customer.name} · ${window}`}
        done={delivery.status === 'delivered'}
        eta={dropoff.etaAt}
      />

      {assigned ? (
        <View style={styles.actions}>
          <Button
            label="Decline"
            variant="secondary"
            fullWidth={false}
            style={styles.flex}
            onPress={onDecline}
          />
          <Button label="Accept job" icon="checkmark" loading={busy} style={styles.flex} onPress={onAccept} />
        </View>
      ) : action ? (
        <View style={styles.footer}>
          <Badge label={meta.label} tone={meta.tone} />
          <Text variant="caption" color="primary">
            {action.label} ›
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function StopLine({
  number,
  icon,
  tone,
  title,
  detail,
  done,
  eta,
}: {
  number: number;
  icon: IconName;
  tone: string;
  title: string;
  detail: string;
  done: boolean;
  eta: number | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.stop}>
      <View style={[styles.number, { backgroundColor: done ? colors.successSoft : colors.surfaceMuted }]}>
        {done ? (
          <Icon name="checkmark" size={14} color={colors.success} />
        ) : (
          <Text variant="micro">{number}</Text>
        )}
      </View>
      <Icon name={icon} size={18} color={tone} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" color={done ? 'success' : 'muted'}>
          {detail}
        </Text>
        {eta != null && !done ? (
          <Text variant="caption" color="subtle">
            ETA {formatClockET(eta)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  flex: { flex: 1 },
  footer: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  kicker: { letterSpacing: 0.6, textTransform: 'uppercase' },
  number: { alignItems: 'center', borderRadius: 11, height: 22, justifyContent: 'center', width: 22 },
  rail: { height: 14, marginLeft: 10, marginVertical: 2, width: 2 },
  stop: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, marginTop: 10 },
  top: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
});
