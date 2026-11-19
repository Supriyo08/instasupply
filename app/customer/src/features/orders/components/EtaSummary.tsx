import {
  formatDistance,
  formatDuration,
  formatEta,
  pluralize,
  toMillis,
  type OrderStatus,
  type PublicTracking,
} from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/** Seconds left, counting down from when the server computed `etaSeconds`. */
function remainingSeconds(tracking: PublicTracking, now: number): number | null {
  if (tracking.etaSeconds == null) return null;
  const computedAt = toMillis(tracking.updatedAt) ?? now;
  return Math.max(0, tracking.etaSeconds - Math.max(0, (now - computedAt) / 1000));
}

export function describeEta(tracking: PublicTracking, orderStatus: OrderStatus, now: number) {
  const remaining = remainingSeconds(tracking, now);
  const stops = tracking.stopsBefore ? `${pluralize(tracking.stopsBefore, 'stop')} before yours` : null;
  if (tracking.status === 'arrived') {
    return {
      arrived: true,
      title: 'Your driver has arrived',
      details: 'Meet them at the door with your hand-off code',
    };
  }
  if (orderStatus === 'packed') {
    return {
      arrived: false,
      title:
        remaining != null && remaining >= 60
          ? `Arriving in about ${formatDuration(remaining)}`
          : 'Packed and ready',
      details: [stops, 'Your driver will start the trip shortly'].filter(Boolean).join(' · '),
    };
  }
  const title =
    remaining == null
      ? 'On the way'
      : remaining < 60
        ? 'Arriving any minute'
        : `Arriving in ${formatDuration(remaining)}`;
  const details = [
    tracking.distanceMeters != null ? `${formatDistance(tracking.distanceMeters)} away` : null,
    remaining != null && remaining >= 60 ? `ETA ${formatEta(remaining, now)}` : null,
    stops,
  ]
    .filter(Boolean)
    .join(' · ');
  return { arrived: false, title, details: details || 'Your driver is on the way' };
}

/** "Arriving in 7 min" headline with distance, clock ETA and stops before yours. */
export function EtaSummary({
  tracking,
  orderStatus,
  now,
}: {
  tracking: PublicTracking;
  orderStatus: OrderStatus;
  now: number;
}) {
  const { arrived, title, details } = describeEta(tracking, orderStatus, now);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${title}. ${details}`}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.text}>
        <Text variant="title">{title}</Text>
        <Text variant="caption" color="muted">
          {details}
        </Text>
      </View>
      <View style={styles.icon}>
        <Icon name={arrived ? 'map-pin' : 'clock'} size={22} color={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: 2 },
});
