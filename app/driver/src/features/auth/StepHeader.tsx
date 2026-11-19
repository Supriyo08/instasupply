import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/** "Step 2 of 4" progress header for onboarding. */
export function StepHeader({
  step,
  total,
  title,
  subtitle,
}: {
  step: number;
  total: number;
  title: string;
  subtitle: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.bars}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[styles.bar, { backgroundColor: index < step ? colors.primary : colors.surfaceMuted }]}
          />
        ))}
      </View>
      <Text variant="micro" color="subtle" style={styles.step}>
        Step {step} of {total}
      </Text>
      <Text variant="display">{title}</Text>
      <Text color="muted">{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 3, flex: 1, height: 5 },
  bars: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  header: { gap: 8, marginTop: 16 },
  step: { letterSpacing: 0.8, textTransform: 'uppercase' },
});
