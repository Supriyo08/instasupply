import {
  DEFAULT_SERVICE_SECONDS,
  formatClock,
  formatDistance,
  formatDuration,
  toMillis,
} from '@instasupply/shared';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Card, EmptyState, IconButton, Screen, SectionHeader, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { AssignmentCard } from '@/features/deliveries/AssignmentCard';
import { DeclineSheet } from '@/features/deliveries/DeclineSheet';
import { DeliveryCard } from '@/features/deliveries/DeliveryCard';
import { useDeliveredToday, useOrderedStops } from '@/features/deliveries/hooks';
import { NextStopCard } from '@/features/deliveries/NextStopCard';
import { useDeliveryAction } from '@/features/deliveries/useDeliveryAction';
import { OnlineCard } from '@/features/location/OnlineCard';
import { usePresence } from '@/features/location/PresenceProvider';
import { useNotifications } from '@/features/notifications/hooks';
import { nextStopOf } from '@/features/route/route-helpers';
import { call } from '@/lib/callables';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" color="subtle">
        {label}
      </Text>
    </Card>
  );
}

export default function TodayScreen() {
  const { user, profile } = useDriver();
  const { stops, route, loading, error } = useOrderedStops(user.uid);
  const { unread } = useNotifications(user.uid);
  const { currentPosition } = usePresence();
  const { run, busyId } = useDeliveryAction();
  const [declining, setDeclining] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const deliveredToday = useDeliveredToday(user.uid, stops.length);
  const newAssignments = stops.filter((stop) => stop.delivery.status === 'assigned');
  const working = stops.filter((stop) => stop.delivery.status !== 'assigned');
  const nextStop = nextStopOf(stops);
  const upNext = working.filter((stop) => stop.delivery.id !== nextStop?.delivery.id);
  const toPickUp = useMemo(() => working.filter((stop) => stop.delivery.status === 'accepted'), [working]);
  const lastPlanned = route?.stops[route.stops.length - 1];
  const computedAt = toMillis(route?.computedAt);
  const finishAt =
    lastPlanned && computedAt
      ? computedAt + (lastPlanned.arrivalOffsetSeconds + DEFAULT_SERVICE_SECONDS) * 1000
      : null;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const origin = await currentPosition();
      await call('optimizeRoute', { origin: origin ? { lat: origin.lat, lng: origin.lng } : null });
    } catch {
      // The live listeners keep the screen current; a failed re-plan isn't fatal.
    } finally {
      setRefreshing(false);
    }
  }, [currentPosition]);

  const pickUpAll = async () => {
    for (const stop of toPickUp) {
      // Sequential on purpose: each change re-plans the route in order.
      if (!(await run(stop.delivery.id, 'picked_up'))) break;
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="caption" color="subtle">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
          <Text variant="title">
            {greeting()}, {profile.displayName.split(' ')[0]}
          </Text>
        </View>
        <IconButton
          icon="notifications-outline"
          label="Notifications"
          badge={unread}
          onPress={() => router.push('/notifications')}
        />
      </View>

      <OnlineCard />

      <View style={styles.stats}>
        <Stat label="Stops left" value={String(working.length)} />
        <Stat label="Delivered today" value={deliveredToday == null ? '—' : String(deliveredToday)} />
        <Stat
          label={finishAt ? `Done ~${formatClock(finishAt)}` : 'Route'}
          value={route?.totalMeters ? formatDistance(route.totalMeters) : '—'}
        />
      </View>

      {error ? <Banner tone="danger" message="Couldn't load your deliveries. Pull to retry." /> : null}

      {newAssignments.length > 0 ? (
        <>
          <SectionHeader title={`New (${newAssignments.length})`} />
          {newAssignments.map((stop) => (
            <AssignmentCard key={stop.delivery.id} stop={stop} onDecline={setDeclining} />
          ))}
        </>
      ) : null}

      {nextStop ? <NextStopCard stop={nextStop} /> : null}

      {toPickUp.length > 1 ? (
        <Button
          label={`Mark all ${toPickUp.length} as picked up`}
          variant="secondary"
          icon="cube-outline"
          loading={!!busyId}
          onPress={() => void pickUpAll()}
        />
      ) : null}

      {upNext.length > 0 ? (
        <>
          <SectionHeader
            title="Up next"
            action={
              route?.totalSeconds ? (
                <Text variant="caption" color="subtle">
                  {formatDuration(route.totalSeconds)} driving ·{' '}
                  {route.provider === 'google' ? 'live traffic' : 'estimated'}
                </Text>
              ) : undefined
            }
          />
          {upNext.map((stop) => (
            <DeliveryCard
              key={stop.delivery.id}
              stop={stop}
              onPress={() => router.push(`/delivery/${stop.delivery.id}`)}
            />
          ))}
        </>
      ) : null}

      {!loading && stops.length === 0 ? (
        <EmptyState
          icon="sunny-outline"
          title="No deliveries right now"
          message="Stay online — new assignments appear here instantly and you'll get a notification."
          action={
            <Button
              label="View history"
              variant="ghost"
              fullWidth={false}
              onPress={() => router.push('/history')}
            />
          }
        />
      ) : null}

      <DeclineSheet deliveryId={declining} onClose={() => setDeclining(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  stat: { flex: 1, gap: 2, paddingHorizontal: 12, paddingVertical: 14 },
  stats: { flexDirection: 'row', gap: 10 },
});
