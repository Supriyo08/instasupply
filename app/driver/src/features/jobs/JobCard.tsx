import {
  formatDistance,
  formatMoney,
  haversineMeters,
  type JobOffer,
  type LatLng,
} from '@instasupply/shared';
import type { WithId } from '@instasupply/api-client';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Icon, Money, Text, type IconName } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { classLabel, loadText, offerTimeText, tripText, unloadText } from './format';

/** One open job on the board (MARKETPLACE §10 `(tabs)/jobs`): pay, class, trip, time, load, unloading. */
export function JobCard({
  offer,
  now,
  from,
  onOpen,
  onHide,
}: {
  offer: WithId<JobOffer>;
  now: number;
  from: LatLng | null;
  onOpen: () => void;
  onHide: () => void;
}) {
  const { colors } = useTheme();
  const trip = tripText(offer);
  const time = offerTimeText(offer, now);
  const load = loadText(offer.load);
  const unload = unloadText(offer.unload);
  const away = from ? formatDistance(haversineMeters(from, offer.pickup.location)) : null;
  const label = [
    `Job paying ${formatMoney(offer.payoutCents)}`,
    classLabel(offer.vehicleClass),
    trip,
    time,
    load,
    unload,
  ].join('. ');

  return (
    <Card onPress={onOpen} accessibilityLabel={label}>
      <View style={styles.top}>
        <Money cents={offer.payoutCents} variant="display" />
        <View style={styles.badges}>
          <Badge label={classLabel(offer.vehicleClass)} tone="brand" icon="car-outline" />
          {offer.load.heavy ? <Badge label="Heavy" tone="warning" icon="barbell-outline" /> : null}
        </View>
      </View>
      <View style={styles.lines}>
        <Text variant="bodyStrong">{trip}</Text>
        <Line icon="time-outline" text={time} color={colors.textSubtle} />
        <Line icon="cube-outline" text={load} color={colors.textSubtle} />
        <Line icon="people-outline" text={unload} color={colors.textSubtle} />
        {away ? (
          <Line icon="navigate-outline" text={`Store ${away} from you`} color={colors.textSubtle} />
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          label="Not for me"
          variant="ghost"
          icon="eye-off-outline"
          fullWidth={false}
          onPress={onHide}
          accessibilityHint="Hides this job on this phone"
        />
        <Button label="View job" variant="secondary" fullWidth={false} onPress={onOpen} />
      </View>
    </Card>
  );
}

function Line({ icon, text, color }: { icon: IconName; text: string; color: string }) {
  return (
    <View style={styles.line}>
      <Icon name={icon} size={16} color={color} />
      <Text variant="caption" color="muted" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  badges: { alignItems: 'flex-end', gap: 6 },
  flex: { flex: 1 },
  line: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  lines: { gap: 6, marginTop: 8 },
  top: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
});
