import { formatDistance, formatRelativeTime, isValidLatLng, toMillis, type Order } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, Skeleton, Text } from '@/components/ui';
import { useTracking } from '@/features/orders/hooks';
import { colors, radius, shadows, spacing } from '@/theme/tokens';

import { DriverRow } from './DriverRow';
import { EtaSummary } from './EtaSummary';
import { HandoffCodeCard } from './HandoffCodeCard';
import { Pulse } from './Pulse';
import { TrackingMap } from './TrackingMap';
import { useNow } from './useNow';

/** A driver position older than this is shown as "Updated 4 min ago" instead of "Live". */
const STALE_AFTER_MS = 3 * 60_000;

/**
 * Live section of Track Order (packed with a driver, or out for delivery): map with the driver
 * and the destination, ETA and distance, the delivery partner and the hand-off code.
 */
export function LiveTracking({ order }: { order: Order }) {
  const { data: tracking, loading } = useTracking(order.trackingToken);
  const now = useNow(15_000);

  if (loading && !tracking) return <Skeleton style={styles.loading} />;
  if (!tracking) return null;
  const driver = tracking.driver;
  if (order.status === 'packed' && !driver) return null;

  const location = driver?.location && isValidLatLng(driver.location) ? driver.location : null;
  const seenAt = toMillis(driver?.updatedAt);
  const stale = location != null && seenAt != null && now - seenAt > STALE_AFTER_MS;
  const showMap = order.status === 'out_for_delivery' && isValidLatLng(tracking.destination);
  const chipLabel = !location
    ? 'Waiting for location'
    : stale
      ? `Updated ${formatRelativeTime(seenAt, now)}`
      : 'Live';
  const mapLabel = location
    ? `Map: your driver is ${formatDistance(tracking.distanceMeters)} from your address`
    : 'Map showing your delivery address';

  return (
    <View style={styles.section}>
      <Card padded={false} style={styles.card}>
        {showMap ? (
          <View>
            <TrackingMap
              destination={tracking.destination}
              driver={location ? { location, heading: driver?.heading ?? null } : null}
              style={styles.map}
              accessibilityLabel={mapLabel}
            />
            <LiveChip live={location != null && !stale} label={chipLabel} />
          </View>
        ) : null}
        <View style={styles.body}>
          <EtaSummary tracking={tracking} orderStatus={order.status} now={now} />
          {driver ? (
            <>
              <Divider />
              <DriverRow name={driver.firstName} vehicle={driver.vehicle} />
            </>
          ) : null}
        </View>
      </Card>
      {tracking.handoffCode ? <HandoffCodeCard code={tracking.handoffCode} /> : null}
    </View>
  );
}

function LiveChip({ live, label }: { live: boolean; label: string }) {
  return (
    <View
      style={[styles.chip, shadows.soft]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.dotWrap}>
        {live ? <Pulse size={8} color={colors.primary} scaleTo={2.6} /> : null}
        <View style={[styles.dot, { backgroundColor: live ? colors.primary : colors.textSubtle }]} />
      </View>
      <Text variant="captionMedium">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, padding: spacing.lg },
  card: { overflow: 'hidden' },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    position: 'absolute',
    top: spacing.md,
  },
  dot: { borderRadius: 4, height: 8, width: 8 },
  dotWrap: { alignItems: 'center', height: 8, justifyContent: 'center', width: 8 },
  loading: { height: 280 },
  map: { height: 210 },
  section: { gap: spacing.lg },
});
