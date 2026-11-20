import {
  asapPromise,
  formatAddressLine,
  formatClockET,
  FREE_DELIVERY_MIN_ITEMS_CENTS,
  formatMoney,
  pickupReady,
  STORE_SPECIALTY_LABELS,
} from '@instasupply/shared';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { mapsUrlFor } from '@/components/map';
import { Card, Icon, Notice, StatusPill, Text } from '@/components/ui';
import type { CurrentSite } from '@/features/site/SiteProvider';
import { colors, spacing } from '@/theme/tokens';

import type { StoreView } from '../hooks';
import { browseOnlyReason } from '../status';

import { StoreBadge } from './StoreBadge';
import { StoreRating } from './StoreRating';

/** "Open · closes 6:00 pm", or the §2.8 badge ("Closed · opens 7:00 am", "Coming soon"). */
function hoursLine(view: StoreView): string {
  const { availability } = view;
  if (availability.openNow && availability.closesAt)
    return `Open · closes ${formatClockET(availability.closesAt)}`;
  return availability.badge ?? 'Closed';
}

/** Delivery and pickup lines of the store page, each with the reason when it can't promise. */
function promises(view: StoreView, site: CurrentSite | null, now: number) {
  const { store } = view;
  let delivery: string;
  if (!store.fulfilment.delivery) delivery = 'Pickup only';
  else if (view.availability.deliverBy)
    delivery = `Delivery by ${formatClockET(view.availability.deliverBy)}`;
  else if (!site || view.roadTenths == null) delivery = 'Choose a jobsite to see delivery times';
  else if (view.roadTenths > store.fulfilment.deliveryRadiusKm * 10)
    delivery = 'Your site is outside its delivery area';
  else {
    const asap = asapPromise(
      { storeId: store.id, store, vehicleClass: 'pickup', roadTenths: view.roadTenths },
      now,
    );
    delivery = asap.ok
      ? `Delivery by ${formatClockET(asap.timing.deliverBy)}`
      : `No delivery now · ${asap.reason}`;
  }
  const pickup = store.fulfilment.pickup ? pickupReady(store, now) : null;
  return {
    delivery,
    pickup: pickup ? (pickup.ok ? `Pickup ${pickup.label.toLowerCase()}` : pickup.reason) : 'No pickup',
  };
}

/** The store page under the hero: name, rating, hours, address and directions, promises, fulfilment. */
export function StoreDetails({
  view,
  site,
  now,
}: {
  view: StoreView;
  site: CurrentSite | null;
  now: number;
}) {
  const { store } = view;
  const browseOnly = browseOnlyReason(store);
  const lines = promises(view, site, now);
  const address = formatAddressLine(store.address);

  return (
    <View style={styles.wrap}>
      <View style={styles.title}>
        <Text variant="title" accessibilityRole="header">
          {store.name}
        </Text>
        <Text color="muted">
          {STORE_SPECIALTY_LABELS[store.specialty]} · {store.areaLabel}
        </Text>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Reviews of ${store.name}`}
            hitSlop={8}
            onPress={() => router.push(`/store/${store.id}/reviews`)}
            style={styles.row}
          >
            <StoreRating rating={store.rating} count={store.ratingCount} />
            <Text variant="captionMedium" color="primary">
              See reviews
            </Text>
          </Pressable>
          <StoreBadge badge={view.availability.badge} />
        </View>
      </View>

      {browseOnly ? <Notice tone="info" title="Browse only" message={browseOnly} /> : null}

      <Card style={styles.card}>
        <InfoRow icon="clock" text={hoursLine(view)} />
        <View style={styles.infoRow}>
          <Icon name="map-pin" size={18} color={colors.textMuted} />
          <Text style={styles.flex}>{address}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Directions to ${store.name}`}
            hitSlop={8}
            onPress={() => void Linking.openURL(mapsUrlFor(store.location, site?.location ?? null))}
          >
            <Text variant="captionMedium" color="primary">
              Directions
            </Text>
          </Pressable>
        </View>
        <InfoRow
          icon="truck"
          text={lines.delivery}
          tone={view.availability.deliverBy ? 'promise' : 'muted'}
        />
        <InfoRow
          icon="shopping-bag"
          text={lines.pickup}
          tone={lines.pickup.startsWith('Pickup ready') ? 'promise' : 'muted'}
        />
        <View style={styles.pills}>
          <StatusPill
            label={store.fulfilment.delivery ? 'Delivery' : 'No delivery'}
            tone={store.fulfilment.delivery ? 'success' : 'neutral'}
          />
          <StatusPill
            label={store.fulfilment.pickup ? 'Pickup' : 'No pickup'}
            tone={store.fulfilment.pickup ? 'success' : 'neutral'}
          />
        </View>
      </Card>

      {store.fulfilment.delivery ? (
        <Notice
          tone="success"
          icon="gift"
          message={`Free delivery on orders over ${formatMoney(FREE_DELIVERY_MIN_ITEMS_CENTS).replace('.00', '')}`}
        />
      ) : null}

      {store.description ? <Text color="muted">{store.description}</Text> : null}
    </View>
  );
}

function InfoRow({
  icon,
  text,
  tone = 'default',
}: {
  icon: 'clock' | 'truck' | 'shopping-bag';
  text: string;
  tone?: 'default' | 'promise' | 'muted';
}) {
  const color = tone === 'promise' ? colors.primaryDark : colors.textMuted;
  return (
    <View style={styles.infoRow}>
      <Icon name={icon} size={18} color={color} />
      <Text
        variant={tone === 'promise' ? 'bodyMedium' : 'body'}
        color={tone === 'promise' ? 'primaryDark' : tone === 'muted' ? 'muted' : 'default'}
        style={styles.flex}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  flex: { flex: 1 },
  infoRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  pills: { flexDirection: 'row', gap: spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  title: { gap: spacing.xs },
  wrap: { gap: spacing.lg },
});
