import { CITIES, type CityId, type LatLng } from '@instasupply/shared';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TabHeader } from '@/components/TabHeader';
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { classLabel } from '@/features/jobs/format';
import { JobCard } from '@/features/jobs/JobCard';
import {
  NEAR_ME_METERS,
  useBoardKey,
  useJobBoard,
  useVisibleJobs,
  type JobFilter,
} from '@/features/jobs/hooks';
import { usePresence } from '@/features/location/PresenceProvider';
import { useNow } from '@/lib/use-now';

const FILTERS: { id: Exclude<JobFilter, 'all'>; label: string }[] = [
  { id: 'ready_now', label: 'Ready now' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'near_me', label: 'Near me' },
];

/** Rounds the last fix to about 100 m, so the board re-sorts when the driver has moved, not on every fix. */
function useRoundedFix(): LatLng | null {
  const { lastFix } = usePresence();
  const lat = lastFix ? Math.round(lastFix.lat * 1000) / 1000 : null;
  const lng = lastFix ? Math.round(lastFix.lng * 1000) / 1000 : null;
  return useMemo(() => (lat != null && lng != null ? { lat, lng } : null), [lat, lng]);
}

/** The job board (MARKETPLACE §10 `(tabs)/jobs`, CLIENTS §4.6): open offers for the driver's city and class. */
export default function JobsScreen() {
  const { profile } = useDriver();
  const { cityId, capacityClass } = useBoardKey();
  const presence = usePresence();
  const board = useJobBoard();
  const now = useNow();
  const from = useRoundedFix();
  const [filter, setFilter] = useState<JobFilter>('all');
  // "Not for me" is a local choice, kept in component state only (CLIENTS §4.6).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useVisibleJobs(board.data, { filter, hidden, from, now });

  const hide = useCallback((deliveryId: string) => {
    setHidden((current) => new Set([...current, deliveryId]));
  }, []);

  const cityName = cityId ? (CITIES[cityId as CityId]?.name ?? cityId) : null;
  const subtitle =
    cityName && capacityClass ? `${cityName} · ${classLabel(capacityClass)} and smaller loads` : undefined;
  const hiddenCount = board.data.filter((offer) => hidden.has(offer.deliveryId)).length;
  const header = <TabHeader title="Jobs" subtitle={subtitle} />;

  if (!cityId || !capacityClass) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="car-outline"
          title="Your vehicle needs approval"
          message={
            profile.vehicleReviewRequired
              ? 'Ops is reviewing your vehicle. Jobs show up here once its class is approved.'
              : 'Jobs show up here once ops has set your city and vehicle class. Message dispatch if it takes long.'
          }
        />
      </Screen>
    );
  }

  if (!presence.online) {
    return (
      <Screen>
        {header}
        <Card>
          <SceneArt scene="scene-local-suppliers" height={140} />
          <View style={styles.offline}>
            <Text variant="heading" align="center">
              Go online to see jobs near you
            </Text>
            <Text color="muted" align="center">
              Lumber yards and supply stores in {cityName} post loads here as soon as they accept an order.
              Dispatch sees where you are while you are online.
            </Text>
            {presence.error && presence.permission !== 'denied' ? (
              <Banner tone="danger" message={presence.error} />
            ) : null}
            {presence.permission === 'denied' ? (
              <Banner tone="warning" message="Location access is off. Turn it on in Settings to go online." />
            ) : null}
            <Button
              label="Go online"
              icon="radio-outline"
              size="lg"
              loading={presence.busy}
              onPress={() => void presence.setOnline(true)}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshing={board.refreshing} onRefresh={board.retry}>
      {header}
      <View style={styles.filters} accessibilityLabel="Filter jobs">
        {FILTERS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={filter === option.id}
            disabled={option.id === 'near_me' && !from}
            onPress={() => setFilter((current) => (current === option.id ? 'all' : option.id))}
          />
        ))}
      </View>
      {filter === 'near_me' ? (
        <Text variant="caption" color="subtle">
          Stores within {NEAR_ME_METERS / 1000} km of you.
        </Text>
      ) : null}

      {board.loading ? (
        <View style={styles.list} accessibilityLabel="Loading jobs">
          <Skeleton height={200} radius={16} />
          <Skeleton height={200} radius={16} />
        </View>
      ) : board.error ? (
        <ErrorState error={board.error} onRetry={board.retry} title="Couldn't load the job board" />
      ) : visible.length === 0 ? (
        <View>
          <SceneArt scene="scene-jobsite-delivery" height={140} />
          <EmptyState
            icon="briefcase-outline"
            title={board.data.length === 0 ? 'No open jobs right now' : 'No jobs match this filter'}
            message={
              board.data.length === 0
                ? 'New loads show up here the moment a store accepts an order. Stay online and we will let you know.'
                : 'Try another filter, or clear it to see every open job.'
            }
            action={
              filter !== 'all' ? (
                <Button
                  label="Show all jobs"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setFilter('all')}
                />
              ) : undefined
            }
          />
        </View>
      ) : (
        visible.map((offer) => (
          <JobCard
            key={offer.deliveryId}
            offer={offer}
            now={now}
            from={from}
            onOpen={() => router.push(`/job/${offer.deliveryId}`)}
            onHide={() => hide(offer.deliveryId)}
          />
        ))
      )}

      {hiddenCount > 0 ? (
        <Button
          label={`Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'job' : 'jobs'}`}
          variant="ghost"
          onPress={() => setHidden(new Set())}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { gap: 16 },
  offline: { gap: 12, marginTop: 8 },
});
