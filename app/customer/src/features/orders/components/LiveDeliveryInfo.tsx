import { StyleSheet, View } from 'react-native';

import { Icon, Skeleton, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { useTracking } from '../hooks';
import { etaText, trackingPhaseText } from '../tracking-format';
import { CodeCard } from './CodeCard';

/**
 * The live part of a store order that is out for delivery (`tracking:{token}`): what the driver is
 * doing, the ETA, and for an attended site the hand-off code.
 */
export function LiveDeliveryInfo({
  token,
  attended,
  now,
}: {
  token: string;
  attended: boolean;
  now: number;
}) {
  const tracking = useTracking(token);
  if (tracking.loading && !tracking.data) return <Skeleton style={styles.skeleton} />;
  const data = tracking.data;
  if (!data) return null;
  const eta = etaText(data, now);
  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessible accessibilityLiveRegion="polite">
        <Icon name="navigation" size={16} color={colors.primaryDark} />
        <View style={styles.text}>
          <Text variant="bodyMedium">{trackingPhaseText(data)}</Text>
          {eta ? (
            <Text variant="caption" color="primaryDark">
              {eta}
            </Text>
          ) : null}
        </View>
      </View>
      {attended && data.handoffCode ? (
        <CodeCard
          icon="shield"
          title="Hand-off code"
          subtitle="Give this code to the driver when the load is on site"
          code={data.handoffCode}
          footnote="Share it only once you've checked the materials."
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  skeleton: { height: 44 },
  text: { flex: 1 },
  wrap: { gap: spacing.md },
});
