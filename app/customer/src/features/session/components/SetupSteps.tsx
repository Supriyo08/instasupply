import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const STEPS = ['Account', 'Your name', 'Phone'] as const;
const DOT = 28;
const STEP_WIDTH = 64;

/** Three-step progress (account → name → phone) in the style of the Big Cart checkout steps. */
export function SetupSteps({ current }: { current: 1 | 2 }) {
  const label = STEPS[current];
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${STEPS.length}: ${label}`}
      accessibilityValue={{ min: 1, max: STEPS.length, now: current + 1 }}
      style={styles.row}
    >
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <Fragment key={step}>
            {index > 0 ? <View style={[styles.line, index <= current && styles.lineDone]} /> : null}
            <View style={styles.step}>
              <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
                {done ? (
                  <Icon name="check" size={15} color={colors.white} />
                ) : (
                  <Text
                    variant="captionMedium"
                    style={{ color: active ? colors.primaryDark : colors.textSubtle }}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text variant="micro" color={done || active ? 'default' : 'subtle'} numberOfLines={1}>
                {step}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    height: DOT,
    justifyContent: 'center',
    width: DOT,
  },
  dotActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  // The line runs under the transparent sides of the step columns, from circle to circle.
  line: {
    backgroundColor: colors.border,
    flex: 1,
    height: 2,
    marginHorizontal: -(STEP_WIDTH - DOT) / 2,
    marginTop: DOT / 2 - 1,
  },
  lineDone: { backgroundColor: colors.primary },
  row: { alignItems: 'flex-start', flexDirection: 'row', paddingHorizontal: spacing.sm },
  step: { alignItems: 'center', gap: spacing.xs, width: STEP_WIDTH },
});
