import { formatClock, formatDistance, formatDuration, formatRelativeTime } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, Icon, StatusBadge, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { useOrderedStops } from '@/features/deliveries/hooks';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { usePresence } from '@/features/location/PresenceProvider';
import { RouteMap } from '@/features/route/RouteMap';
import { nextStopOf, routePath, toMapStops } from '@/features/route/route-helpers';
import { call } from '@/lib/callables';
import { describeError } from '@/lib/errors';
import { openNavigation } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

export default function RouteScreen() {
  const { user } = useDriver();
  const { colors } = useTheme();
  const { lastFix, currentPosition } = usePresence();
  const { stops, route, loading } = useOrderedStops(user.uid);
  const [optimizing, setOptimizing] = useState(false);

  const next = nextStopOf(stops);
  const driver = lastFix ?? route?.origin ?? null;
  const mapStops = useMemo(() => toMapStops(stops, next?.delivery.id ?? null), [stops, next?.delivery.id]);
  const path = useMemo(() => routePath(route, driver, stops), [route, driver, stops]);

  const reoptimize = async () => {
    setOptimizing(true);
    try {
      const origin = await currentPosition();
      const result = await call('optimizeRoute', {
        origin: origin ? { lat: origin.lat, lng: origin.lng } : null,
      });
      notify(
        'Route updated',
        `${result.stops} stops · ${formatDuration(result.totalSeconds)} · ${formatDistance(result.totalMeters)}`,
      );
    } catch (error) {
      notify("Couldn't re-plan the route", describeError(error));
    } finally {
      setOptimizing(false);
    }
  };

  const navigateAll = () => {
    if (stops.length === 0) return;
    const ordered = stops.map((stop) => stop.delivery.location);
    void openNavigation(ordered[ordered.length - 1]!, { origin: lastFix, waypoints: ordered.slice(0, -1) });
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <RouteMap
        style={styles.map}
        driver={driver ? { lat: driver.lat, lng: driver.lng, heading: lastFix?.heading ?? null } : null}
        stops={mapStops}
        path={path}
        onStopPress={(id) => router.push(`/delivery/${id}`)}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <View style={styles.flex}>
            <Text variant="title">{stops.length ? `${stops.length} stops` : 'No stops'}</Text>
            <Text variant="caption" color="subtle">
              {route?.totalSeconds
                ? `${formatDuration(route.totalSeconds)} driving · ${formatDistance(route.totalMeters)} · planned ${formatRelativeTime(route.computedAt)}`
                : 'Your optimized route appears here.'}
            </Text>
          </View>
          {route ? (
            <Badge
              label={
                route.provider === 'google'
                  ? 'Live traffic'
                  : route.provider === 'osrm'
                    ? 'Road network'
                    : 'Estimated'
              }
              tone={route.provider === 'google' ? 'success' : 'neutral'}
              icon={route.provider === 'google' ? 'pulse' : 'analytics-outline'}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              label="Re-optimize"
              icon="sparkles-outline"
              variant="secondary"
              loading={optimizing}
              onPress={reoptimize}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label="Navigate all"
              icon="navigate"
              disabled={stops.length === 0}
              onPress={navigateAll}
            />
          </View>
        </View>

        {!loading && stops.length === 0 ? (
          <EmptyState
            icon="map-outline"
            title="Nothing to route yet"
            message="Accepted deliveries are ordered here automatically."
          />
        ) : null}

        {stops.map((stop, index) => {
          const isNext = stop.delivery.id === next?.delivery.id;
          return (
            <View key={stop.delivery.id} style={styles.stopRow}>
              <View style={styles.rail}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: isNext ? colors.primary : colors.surface,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text variant="micro" style={{ color: isNext ? colors.onPrimary : colors.primary }}>
                    {stop.sequence}
                  </Text>
                </View>
                {index < stops.length - 1 ? (
                  <View style={[styles.line, { backgroundColor: colors.border }]} />
                ) : null}
              </View>
              <View style={styles.stopBody}>
                <View style={styles.stopTitle}>
                  <Text
                    variant="bodyStrong"
                    numberOfLines={1}
                    style={styles.flex}
                    onPress={() => router.push(`/delivery/${stop.delivery.id}`)}
                  >
                    {stop.delivery.customer.name}
                  </Text>
                  {stop.etaAt ? (
                    <Text variant="caption" color="primary">
                      {formatClock(stop.etaAt)}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" color="muted" numberOfLines={1}>
                  {stop.delivery.address}
                </Text>
                <View style={styles.stopMeta}>
                  <StatusBadge status={stop.delivery.status} />
                  {stop.plan ? (
                    <View style={styles.leg}>
                      <Icon name="car-outline" size={13} color={colors.textSubtle} />
                      <Text variant="caption" color="subtle">
                        {formatDuration(stop.plan.legSeconds)} · {formatDistance(stop.plan.legMeters)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  badge: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  content: { gap: 14, padding: 20, paddingBottom: 40 },
  fill: { flex: 1 },
  flex: { flex: 1 },
  leg: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  line: { flex: 1, marginVertical: 2, width: 2 },
  map: { height: '45%' },
  rail: { alignItems: 'center', width: 28 },
  stopBody: { flex: 1, gap: 4, paddingBottom: 18 },
  stopMeta: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  stopRow: { flexDirection: 'row', gap: 12 },
  stopTitle: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  summary: { alignItems: 'center', flexDirection: 'row', gap: 12 },
});
