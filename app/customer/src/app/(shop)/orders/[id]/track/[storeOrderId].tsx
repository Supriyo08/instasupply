import { describeError } from '@instasupply/api-client';
import { useConfig } from '@instasupply/api-client/react';
import type { LatLng, PublicTracking } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppMap, fitKeyFor, type MapMarker } from '@/components/map';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import { CodeCard } from '@/features/orders/components/CodeCard';
import { DriverRow } from '@/features/orders/components/DriverRow';
import { Pulse } from '@/features/orders/components/Pulse';
import { useOrder, useTracking } from '@/features/orders/hooks';
import { dayAndClock } from '@/features/orders/order-format';
import { firstParam } from '@/features/orders/params';
import { etaText, isInTransit, trackingPhaseText } from '@/features/orders/tracking-format';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useNow } from '@/hooks/useNow';
import { notify } from '@/lib/notify';
import { colors, radius, spacing } from '@/theme/tokens';

/** Live tracking of one delivery 🔒 (MARKETPLACE §7.3 track row; CLIENTS §4.3, §7.4). */
export default function TrackScreen() {
  return (
    <RequireAccount title="Track delivery">
      <TrackBody />
    </RequireAccount>
  );
}

function TrackBody() {
  const params = useLocalSearchParams<{ id: string; storeOrderId: string }>();
  const orderId = firstParam(params.id);
  const storeOrderId = firstParam(params.storeOrderId);
  const order = useOrder(orderId);
  const summary = order.data?.storeOrders.find((entry) => entry.storeOrderId === storeOrderId) ?? null;
  const token = summary?.trackingToken ?? null;
  const tracking = useTracking(token);
  const config = useConfig();
  const now = useNow(15_000);
  const { height } = useWindowDimensions();
  const title = summary ? `Track ${summary.number}` : 'Track delivery';

  const share = async () => {
    if (!token || !config) return;
    const url = `${config.trackingBaseUrl.replace(/\/+$/, '')}/${token}`;
    try {
      await Share.share({
        message: `Track the ${summary?.storeName ?? 'InstaSupply'} delivery live: ${url}`,
        url,
      });
    } catch (error) {
      notify("Couldn't share the link", describeError(error));
    }
  };

  const header = (
    <Header
      title={title}
      right={
        token && config ? (
          <IconButton icon="share-2" label="Share the tracking link" onPress={() => void share()} />
        ) : undefined
      }
    />
  );

  if ((order.loading && !order.data) || (tracking.loading && !tracking.data && token)) {
    return (
      <Screen header={header}>
        <Skeleton style={{ height: height * 0.5 }} />
        <Skeleton style={styles.skeletonCard} />
      </Screen>
    );
  }
  const failure = order.error ?? tracking.error;
  if (failure && !tracking.data) {
    return (
      <Screen header={header}>
        <ErrorState
          title="Couldn't load tracking"
          error={failure}
          onRetry={() => {
            order.retry();
            tracking.retry();
          }}
        />
      </Screen>
    );
  }
  if (!summary || !token || !tracking.data) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-live-tracking"
          title="Tracking isn't live yet"
          message="Live tracking starts once a driver has your delivery. We'll notify you when it's on the way."
          action={
            orderId ? (
              <Button label="Back to the order" onPress={() => router.replace(`/orders/${orderId}`)} />
            ) : undefined
          }
        />
      </Screen>
    );
  }
  return (
    <Screen header={header} scroll={false} contentStyle={styles.full}>
      <LiveMap tracking={tracking.data} />
      {/* The map fills the screen; the details sit in a sheet over its lower part. */}
      <ScrollView
        style={[styles.sheet, { maxHeight: Math.round(height * 0.45) }]}
        contentContainerStyle={styles.sheetContent}
      >
        <TrackingDetails tracking={tracking.data} now={now} storeName={summary.storeName} />
      </ScrollView>
    </Screen>
  );
}

function LiveMap({ tracking }: { tracking: PublicTracking }) {
  const driverAt = tracking.driver?.location ?? null;
  const markers = useMemo(() => {
    const list: MapMarker[] = [
      { id: 'site', kind: 'site', position: tracking.destination, title: 'Your jobsite', tone: 'brand' },
    ];
    if (tracking.pickup) {
      list.push({
        id: 'store',
        kind: 'store',
        position: tracking.pickup.location,
        title: tracking.pickup.storeName,
        tone: 'neutral',
      });
    }
    if (driverAt) {
      list.push({
        id: 'driver',
        kind: 'driver',
        position: driverAt,
        heading: tracking.driver?.heading ?? null,
        title: tracking.driver?.firstName ?? 'Driver',
        tone: 'brand',
        glide: true,
        zIndex: 10,
      });
    }
    return list;
  }, [driverAt, tracking.destination, tracking.driver?.firstName, tracking.driver?.heading, tracking.pickup]);
  // The camera fits the store, the site and the driver's first fix, then stays where the user put it.
  const fitPoints: LatLng[] = [tracking.destination];
  if (tracking.pickup) fitPoints.push(tracking.pickup.location);
  const fitKey = `${fitKeyFor(fitPoints)}|${driverAt ? 'driver' : 'none'}`;
  if (driverAt) fitPoints.push(driverAt);
  const label = `Map: ${tracking.pickup ? `${tracking.pickup.storeName}, ` : ''}your jobsite${driverAt ? ' and the driver' : ''}.`;
  return (
    <AppMap
      markers={markers}
      fit={{ key: fitKey, points: fitPoints }}
      interactive
      style={styles.map}
      accessibilityLabel={label}
    />
  );
}

function TrackingDetails({
  tracking,
  now,
  storeName,
}: {
  tracking: PublicTracking;
  now: number;
  storeName: string;
}) {
  const eta = etaText(tracking, now);
  const live = isInTransit(tracking);
  return (
    <>
      <Card style={styles.card}>
        <View style={styles.phaseRow} accessible accessibilityLiveRegion="polite">
          <View style={styles.liveDot}>
            {live ? <Pulse size={14} color={colors.primary} scaleTo={2.2} /> : null}
            <View style={[styles.dot, { backgroundColor: live ? colors.primary : colors.textSubtle }]} />
          </View>
          <View style={styles.flex}>
            <Text variant="title">{trackingPhaseText(tracking)}</Text>
            {eta ? <Text color="primaryDark">{eta}</Text> : null}
          </View>
        </View>
        {tracking.deliverBy != null ? (
          <Text variant="caption" color="muted">
            Deliver by {dayAndClock(tracking.deliverBy, now)}
            {tracking.windowLabel ? ` · ${tracking.windowLabel}` : ''}
          </Text>
        ) : null}
        {tracking.stopsBefore ? (
          <Text variant="caption" color="muted">
            {tracking.stopsBefore === 1
              ? '1 stop before yours'
              : `${tracking.stopsBefore} stops before yours`}
          </Text>
        ) : null}
        <Text variant="caption" color="muted">
          From {storeName} to {tracking.address}
        </Text>
        {tracking.driver ? (
          <DriverRow name={tracking.driver.firstName} vehicle={tracking.driver.vehicle} />
        ) : null}
        {tracking.unloadNote ? (
          <Text variant="caption" color="muted">
            {tracking.unloadNote}
          </Text>
        ) : null}
      </Card>
      {tracking.receiving === 'attended' && tracking.handoffCode ? (
        <CodeCard
          icon="shield"
          title="Hand-off code"
          subtitle="Give this code to the driver when the load is on site"
          code={tracking.handoffCode}
          footnote="Share it only once you've checked the materials."
        />
      ) : tracking.receiving === 'unattended' ? (
        <Text variant="caption" color="muted" align="center">
          Leave at site: the driver takes a drop-off photo, which appears on your order.
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm + 2 },
  full: { paddingHorizontal: 0, paddingTop: 0 },
  dot: { borderRadius: 7, height: 14, width: 14 },
  flex: { flex: 1 },
  liveDot: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  map: { flex: 1 },
  phaseRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
  },
  sheetContent: { gap: spacing.md, padding: spacing.gutter },
  skeletonCard: { height: 140 },
});
