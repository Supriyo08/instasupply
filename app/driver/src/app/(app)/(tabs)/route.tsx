import { formatClockET, formatDistance, formatDuration, formatRelativeTime } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppMap, fitKeyFor } from '@/components/map';
import { TabHeader } from '@/components/TabHeader';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { optimizeRoute } from '@/features/deliveries/actions';
import { nextStopOf, useOrderedStops, type PlannedStop } from '@/features/deliveries/hooks';
import { usePresence } from '@/features/location/PresenceProvider';
import { deliveryIdOfStopKey, driverMarker, routeLine, stopMarkers } from '@/features/route/route-map';
import { describeError } from '@/lib/api';
import { openNavigation } from '@/lib/links';
import { useNow } from '@/lib/use-now';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The planned route (MARKETPLACE §10 `(tabs)/route`, §5.11; CLIENTS §4.6, §7.4): pickup stops at the
 * store and drop-off stops at the site, a job's pickup always before its drop-off. Stops come from
 * `useOrderedStops`, which treats a plan without `stops` as no plan (R56, R61).
 */
export default function RouteScreen() {
  const { user } = useDriver();
  const { lastFix } = usePresence();
  const now = useNow();
  const { colors } = useTheme();
  const { stops, route, loading, error, retry } = useOrderedStops(user.uid);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const next = nextStopOf(stops);
  const map = useMemo(() => {
    const driver = driverMarker(lastFix);
    const markers = [...(driver ? [driver] : []), ...stopMarkers(stops, next?.key ?? null)];
    // Fit on the stops (and the driver once), so a moving driver does not pull the camera around.
    const points = [...(driver ? [driver.position] : []), ...stops.map((stop) => stop.location)];
    const keyPoints = stops.map((stop) => stop.location);
    return {
      markers,
      polylines: stops.length > 0 ? [routeLine(route, driver?.position ?? null, stops)] : [],
      fit: points.length > 0 ? { key: fitKeyFor(keyPoints) || 'driver', points } : null,
    };
  }, [lastFix, stops, route, next?.key]);

  const reoptimize = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await optimizeRoute(lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null);
    } catch (cause) {
      setProblem(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const navigateAll = () => {
    const ahead = stops.filter((stop) => stop.delivery.status !== 'assigned');
    const last = ahead[ahead.length - 1];
    if (!last) return;
    void openNavigation(last.location, {
      origin: lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null,
      waypoints: ahead.slice(0, -1).map((stop) => stop.location),
    });
  };

  const pickups = stops.filter((stop) => stop.kind === 'pickup').length;
  const subtitle =
    stops.length === 0
      ? 'No stops planned'
      : `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'} · ${pickups} at stores`;

  return (
    <Screen onRefresh={retry} refreshing={false}>
      <TabHeader title="Route" subtitle={subtitle} />
      {loading ? (
        <Skeleton height={280} radius={16} />
      ) : (
        <AppMap
          interactive
          markers={map.markers}
          polylines={map.polylines}
          fit={map.fit}
          onMarkerPress={(id) => {
            if (id !== 'driver') router.push(`/delivery/${deliveryIdOfStopKey(id)}`);
          }}
          style={styles.map}
          accessibilityLabel={`Map of your route: ${stops.length} stops, ${pickups} at stores${lastFix ? ', and your position' : ''}`}
        />
      )}

      {error ? <ErrorState error={error} onRetry={retry} title="Couldn't load your route" /> : null}
      {problem ? <Banner tone="danger" title="Couldn't re-plan the route" message={problem} /> : null}

      {!loading && !error && stops.length === 0 ? (
        <Card>
          <SceneArt scene="scene-live-tracking" height={130} />
          <EmptyState
            icon="map-outline"
            title="Nothing on your route"
            message="Claimed and assigned jobs appear here with the store first, then the site."
            action={<Button label="Find a job" fullWidth={false} onPress={() => router.navigate('/jobs')} />}
          />
        </Card>
      ) : null}

      {stops.length > 0 ? (
        <>
          <Card>
            <View style={styles.summary}>
              <View style={styles.flex}>
                <Text variant="heading">
                  {route
                    ? `${formatDistance(route.totalMeters)} · ${formatDuration(route.totalSeconds)}`
                    : 'Not planned yet'}
                </Text>
                <Text variant="caption" color="muted">
                  {route
                    ? `Planned ${formatRelativeTime(route.computedAt, now)}${route.provider === 'estimate' ? ' · estimated times' : ''}`
                    : 'The route is planned when a job is added. Tap Re-plan to plan it now.'}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Button
                label="Re-plan from here"
                icon="git-branch-outline"
                variant="secondary"
                loading={busy}
                style={styles.flex}
                onPress={() => void reoptimize()}
              />
              <Button label="Navigate" icon="navigate" style={styles.flex} onPress={navigateAll} />
            </View>
          </Card>

          <SectionHeader title="Stops in order" />
          {stops.map((stop) => (
            <StopRow
              key={stop.key}
              stop={stop}
              next={stop.key === next?.key}
              colors={{ pickup: colors.warning, dropoff: colors.primary, border: colors.border }}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function StopRow({
  stop,
  next,
  colors,
}: {
  stop: PlannedStop;
  next: boolean;
  colors: { pickup: string; dropoff: string; border: string };
}) {
  const pickup = stop.kind === 'pickup';
  const tone = pickup ? colors.pickup : colors.dropoff;
  const what = pickup ? 'Pick up at' : 'Drop off at';
  const pending = stop.delivery.status === 'assigned';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Stop ${stop.sequence}. ${what} ${stop.title}, ${stop.address}${stop.etaAt ? `, ETA ${formatClockET(stop.etaAt)}` : ''}${pending ? ', waiting for you to accept' : ''}`}
      onPress={() => router.push(`/delivery/${stop.delivery.id}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <Card accent={next ? tone : undefined}>
        <View style={styles.stop}>
          <View style={[styles.badge, { borderColor: tone }]}>
            <Text variant="bodyStrong" style={{ color: tone }}>
              {stop.sequence}
            </Text>
          </View>
          <View style={styles.flex}>
            <View style={styles.kindRow}>
              <Icon name={pickup ? 'storefront-outline' : 'construct-outline'} size={14} color={tone} />
              <Text variant="micro" style={{ color: tone }}>
                {pickup ? 'STORE PICKUP' : 'SITE DROP-OFF'}
                {next ? ' · NEXT' : ''}
              </Text>
            </View>
            <Text variant="bodyStrong" numberOfLines={1}>
              {stop.title}
            </Text>
            <Text variant="caption" color="muted" numberOfLines={2}>
              {stop.address}
            </Text>
            <Text variant="caption" color="subtle">
              {stop.delivery.orderId}
              {stop.etaAt ? ` · ETA ${formatClockET(stop.etaAt)}` : ''}
              {pending ? ' · accept on Today' : ''}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.border} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  badge: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  flex: { flex: 1 },
  kindRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  map: { borderRadius: 16, height: 280, overflow: 'hidden' },
  stop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  summary: { flexDirection: 'row', gap: 12 },
});
