import { formatDayET, formatMoney } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TabHeader } from '@/components/TabHeader';
import { Button, Card, EmptyState, ErrorState, Screen, SectionHeader, Skeleton, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { DeclineSheet } from '@/features/deliveries/DeclineSheet';
import { nextStopOf, useDeliveredToday, useOrderedStops } from '@/features/deliveries/hooks';
import { TodayJobCard } from '@/features/deliveries/TodayJobCard';
import { useDeliveryAction } from '@/features/deliveries/useDeliveryAction';
import { OnlineCard } from '@/features/location/OnlineCard';
import { useNow } from '@/lib/use-now';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Today (MARKETPLACE §10 `(tabs)/index`, CLIENTS §4.6): the online switch, assignments from dispatch to
 * accept or decline, and the day's jobs as two-stop cards in route order.
 */
export default function TodayScreen() {
  const { user, profile } = useDriver();
  const now = useNow();
  const { stops, jobs, loading, error, retry } = useOrderedStops(user.uid);
  const today = useDeliveredToday(user.uid);
  const { run, busyId } = useDeliveryAction();
  const [declining, setDeclining] = useState<string | null>(null);

  const next = nextStopOf(stops);
  const assigned = jobs.filter((job) => job.delivery.status === 'assigned');
  const active = jobs.filter((job) => job.delivery.status !== 'assigned');
  const firstName = profile.displayName.split(' ')[0] ?? profile.displayName;
  const earned = profile.driverStats?.earnedCents;

  const card = (job: (typeof jobs)[number]) => (
    <TodayJobCard
      key={job.delivery.id}
      job={job}
      now={now}
      next={next?.delivery.id === job.delivery.id}
      busy={busyId === job.delivery.id}
      onOpen={() => router.push(`/delivery/${job.delivery.id}`)}
      onAccept={() => void run(job.delivery.id, 'accepted')}
      onDecline={() => setDeclining(job.delivery.id)}
    />
  );

  return (
    <Screen refreshing={false} onRefresh={retry}>
      <TabHeader title={`Hi, ${firstName}`} subtitle={`${formatDayET(now, now)} · your jobs`} />
      <OnlineCard />

      <Stats
        items={[
          { label: 'Active', value: loading ? '–' : String(jobs.length) },
          { label: 'Delivered today', value: today ? String(today.delivered) : '–' },
          { label: 'Failed today', value: today ? String(today.failed) : '–' },
        ]}
      />

      {loading ? (
        <View style={styles.list} accessibilityLabel="Loading your jobs">
          <Skeleton height={170} radius={16} />
          <Skeleton height={170} radius={16} />
        </View>
      ) : error ? (
        <ErrorState error={error} onRetry={retry} title="Couldn't load your jobs" />
      ) : jobs.length === 0 ? (
        <Card>
          <SceneArt scene="scene-welcome" height={140} />
          <EmptyState
            icon="briefcase-outline"
            title="No jobs yet today"
            message="Claim a load from the job board, or stay online so dispatch can assign one to you."
            action={
              <Button
                label="Find a job"
                icon="search"
                fullWidth={false}
                onPress={() => router.navigate('/jobs')}
              />
            }
          />
        </Card>
      ) : (
        <>
          {assigned.length > 0 ? (
            <>
              <SectionHeader title={`Assigned by dispatch · ${assigned.length}`} />
              {assigned.map(card)}
            </>
          ) : null}
          {active.length > 0 ? (
            <>
              <SectionHeader
                title={`In progress · ${active.length}`}
                action={
                  <Button
                    label="Route"
                    variant="ghost"
                    icon="map-outline"
                    fullWidth={false}
                    onPress={() => router.navigate('/route')}
                  />
                }
              />
              {active.map(card)}
            </>
          ) : null}
        </>
      )}

      <View style={styles.links}>
        <Button
          label="Past deliveries"
          variant="secondary"
          icon="time-outline"
          fullWidth={false}
          style={styles.flex}
          onPress={() => router.push('/history')}
        />
        <Button
          label="Earnings"
          variant="secondary"
          icon="wallet-outline"
          fullWidth={false}
          style={styles.flex}
          onPress={() => router.navigate('/earnings')}
        />
      </View>
      {earned != null ? (
        <Text variant="caption" color="subtle" align="center">
          {profile.driverStats?.deliveries ?? 0} deliveries with InstaSupply · {formatMoney(earned)} earned
        </Text>
      ) : null}

      <DeclineSheet deliveryId={declining} onClose={() => setDeclining(null)} />
    </Screen>
  );
}

function Stats({ items }: { items: { label: string; value: string }[] }) {
  const { colors, radius } = useTheme();
  return (
    <View style={styles.stats}>
      {items.map((item) => (
        <View
          key={item.label}
          accessible
          accessibilityLabel={`${item.label}: ${item.value}`}
          style={[
            styles.stat,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md },
          ]}
        >
          <Text variant="title">{item.value}</Text>
          <Text variant="caption" color="muted">
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  links: { flexDirection: 'row', gap: 10 },
  list: { gap: 16 },
  stat: { borderWidth: StyleSheet.hairlineWidth, flex: 1, gap: 2, padding: 12 },
  stats: { flexDirection: 'row', gap: 10 },
});
