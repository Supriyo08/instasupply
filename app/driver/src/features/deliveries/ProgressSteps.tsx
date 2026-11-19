import { PROGRESS_STEPS, STATUS_META, progressIndex, type DeliveryStatus } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

const SHORT_LABELS: Partial<Record<DeliveryStatus, string>> = {
  assigned: 'Accepted',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  arrived: 'Arrived',
  delivered: 'Delivered',
};

export function ProgressSteps({ status }: { status: DeliveryStatus }) {
  const { colors } = useTheme();
  const current = status === 'assigned' ? -1 : progressIndex(status);
  if (status === 'failed' || status === 'cancelled') {
    return (
      <Text color="danger" variant="bodyStrong">
        {STATUS_META[status].label}
      </Text>
    );
  }
  return (
    <View style={styles.row} accessibilityLabel={`Progress: ${STATUS_META[status].label}`}>
      {PROGRESS_STEPS.map((step, index) => {
        const done = index <= current;
        return (
          <View key={step} style={styles.step}>
            <View style={[styles.bar, { backgroundColor: done ? colors.primary : colors.surfaceMuted }]} />
            <Text variant="micro" color={done ? 'primary' : 'subtle'} numberOfLines={1}>
              {SHORT_LABELS[step]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 3, height: 5 },
  row: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, gap: 6 },
});
