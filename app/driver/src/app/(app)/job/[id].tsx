import { formatMoney } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppMap, fitKeyFor, type MapCircle, type MapMarker } from '@/components/map';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Money,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { claimJob } from '@/features/deliveries/actions';
import {
  classLabel,
  feetText,
  kmText,
  loadText,
  offerTimeText,
  unloadText,
  weightText,
} from '@/features/jobs/format';
import { notify } from '@/features/deliveries/useDeliveryAction';
import { useJobOffer } from '@/features/jobs/hooks';
import { usePresence } from '@/features/location/PresenceProvider';
import { describeError, errorCodeOf } from '@/lib/api';
import { useNow } from '@/lib/use-now';
import { useTheme } from '@/theme/ThemeProvider';

const TAKEN = 'Someone else just took this job';

/** What the unloading line means for the driver, in a sentence. */
const UNLOAD_DETAIL = {
  site_crew:
    'Someone on site receives the load and their crew helps you unload. Ask them for the hand-off code.',
  labourer: 'A labourer booked by InstaSupply meets you at the site to unload.',
  driver: 'Nobody receives this load: unload it where the instructions say and take the drop-off photo.',
} as const;

/** One open job (MARKETPLACE §10 `job/[id]`, CLIENTS §4.6, §7.4). */
export default function JobOfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = useJobOffer(id);
  const now = useNow();
  const { colors } = useTheme();
  const { online } = usePresence();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful claim the offer is deleted; this keeps the screen from flashing "taken".
  const claimed = useRef(false);

  const data = offer.data;
  const map = useMemo(() => {
    if (!data) return null;
    const markers: MapMarker[] = [
      {
        id: 'store',
        kind: 'store',
        position: data.pickup.location,
        title: `Pick up at ${data.pickup.storeName}`,
        tone: 'warning',
      },
    ];
    const circles: MapCircle[] = [
      { id: 'site', center: data.dropoff.approxLocation, radiusM: 1000, tone: 'brand' },
    ];
    const points = [data.pickup.location, data.dropoff.approxLocation];
    return { markers, circles, fit: { key: fitKeyFor(points), points, padding: 40 } };
  }, [data]);

  if (offer.loading) {
    return (
      <Screen edges={[]}>
        <Skeleton height={200} radius={16} />
        <Skeleton height={120} radius={16} />
        <Skeleton height={160} radius={16} />
      </Screen>
    );
  }
  if (offer.error) {
    return (
      <Screen edges={[]}>
        <ErrorState error={offer.error} onRetry={offer.retry} title="Couldn't load this job" />
      </Screen>
    );
  }
  if (!data || !map) {
    if (claimed.current) return <Screen edges={[]}>{null}</Screen>;
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="hand-left-outline"
          title={TAKEN}
          message="Another driver claimed it, or the store withdrew it. There are more loads on the board."
          action={<Button label="Back to jobs" fullWidth={false} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await claimJob(data.deliveryId);
      claimed.current = true;
      router.replace(`/delivery/${data.deliveryId}`);
    } catch (cause) {
      setBusy(false);
      if (errorCodeOf(cause) === 'OFFER_TAKEN') {
        notify(TAKEN, 'Another driver claimed it first. Pick another load from the board.');
        router.back();
        return;
      }
      setError(describeError(cause));
    }
  };

  const breakdown = data.payoutBreakdown;
  const parts: { label: string; cents: number }[] = [
    { label: 'Base', cents: breakdown.baseCents },
    { label: 'Distance', cents: breakdown.distanceCents },
    { label: 'Load', cents: breakdown.loadCents },
    { label: 'Handling', cents: breakdown.handlingCents },
    ...(breakdown.boostCents > 0 ? [{ label: 'Boost', cents: breakdown.boostCents }] : []),
  ];
  const more = data.load.pieces - data.load.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <Screen
      edges={[]}
      footer={
        <>
          {error ? <Banner tone="danger" message={error} /> : null}
          {!online ? (
            <Text variant="caption" color="subtle" align="center">
              Go online first if the pickup is within 2 hours.
            </Text>
          ) : null}
          <Button
            label={`Accept job · ${formatMoney(data.payoutCents)}`}
            icon="checkmark-circle-outline"
            size="lg"
            loading={busy}
            onPress={() => void accept()}
          />
        </>
      }
    >
      <AppMap
        markers={map.markers}
        circles={map.circles}
        fit={map.fit}
        style={styles.map}
        accessibilityLabel={`Map: ${data.pickup.storeName} in ${data.pickup.areaLabel}, and the area of the site in ${data.dropoff.areaLabel}. The exact site is shown after you accept.`}
      />

      <View style={styles.headline}>
        <View style={styles.flex}>
          <Money cents={data.payoutCents} variant="display" />
          <Text color="muted">{offerTimeText(data, now)}</Text>
        </View>
        <Badge label={classLabel(data.vehicleClass)} tone="brand" icon="car-outline" />
      </View>

      <Card>
        <Stop
          icon="storefront-outline"
          color={colors.warning}
          title={data.pickup.storeName}
          detail={`${data.pickup.areaLabel} · ${data.pickup.ready ? 'Order ready' : 'Being prepared'}`}
        />
        <View style={[styles.rail, { backgroundColor: colors.border }]} />
        <Stop
          icon="construct-outline"
          color={colors.primary}
          title={data.dropoff.areaLabel}
          detail={`${kmText(data.tripKm)} trip · exact site shown after you accept`}
        />
      </Card>

      <SectionHeader title="Load" />
      <Card>
        <Text variant="bodyStrong">{loadText(data.load)}</Text>
        <View style={styles.lines}>
          {data.load.lines.map((line, index) => (
            <View key={`${line.name}-${index}`} style={styles.lineRow}>
              <Text style={styles.qty}>{line.quantity} ×</Text>
              <Text style={styles.flex}>{line.name}</Text>
            </View>
          ))}
          {more > 0 ? (
            <Text variant="caption" color="subtle">
              +{more} more {more === 1 ? 'piece' : 'pieces'}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" color="muted">
          {data.load.pieces} pieces · {weightText(data.load.weightKg)} · longest{' '}
          {feetText(data.load.longestCm)}
          {data.load.hasSheets ? ' · 4×8 sheets' : ''}
          {data.load.heavy ? ' · heavy load' : ''}
        </Text>
      </Card>

      <SectionHeader title="Unloading" />
      <Card>
        <Text variant="bodyStrong">{unloadText(data.unload)}</Text>
        <Text color="muted">{UNLOAD_DETAIL[data.unload]}</Text>
      </Card>

      <SectionHeader title="Pay" />
      <Card accessibilityLabel={`Pay: ${formatMoney(data.payoutCents)}`}>
        {parts.map((part) => (
          <View key={part.label} style={styles.payRow}>
            <Text color="muted">{part.label}</Text>
            <Money cents={part.cents} />
          </View>
        ))}
        <View style={[styles.payRow, styles.total, { borderTopColor: colors.border }]}>
          <Text variant="bodyStrong">You earn</Text>
          <Money cents={data.payoutCents} variant="bodyStrong" />
        </View>
        <Text variant="caption" color="subtle">
          Waiting more than 15 minutes at the store adds 25¢ a minute, up to $15.
        </Text>
      </Card>

      <SceneArt scene="scene-jobsite-delivery" height={120} />
    </Screen>
  );
}

function Stop({
  icon,
  color,
  title,
  detail,
}: {
  icon: 'storefront-outline' | 'construct-outline';
  color: string;
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.stop}>
      <Icon name={icon} size={22} color={color} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="muted">
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headline: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  lineRow: { flexDirection: 'row', gap: 8 },
  lines: { gap: 4, marginVertical: 10 },
  map: { borderRadius: 16, height: 200, overflow: 'hidden' },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  qty: { minWidth: 44 },
  rail: { height: 18, marginLeft: 10, marginVertical: 4, width: 2 },
  stop: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  total: { borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 8, marginTop: 6, paddingTop: 10 },
});
