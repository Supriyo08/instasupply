import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const DEFAULT_STEPS = ['Delivery', 'Address', 'Payment'] as const;
const CIRCLE = 36;
const COLUMN = 78;

type StepState = 'done' | 'current' | 'todo';

/**
 * Big Cart checkout progress: green check circles for finished steps, a ringed green circle for
 * the current one and white circles for what is left, joined by a line that fills in green.
 */
export function StepProgress({
  current,
  steps = DEFAULT_STEPS,
}: {
  current: number;
  steps?: readonly string[];
}) {
  const currentLabel = steps[current] ?? '';
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Checkout step ${current + 1} of ${steps.length}: ${currentLabel}`}
      accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
      style={styles.row}
    >
      {steps.map((label, index) => {
        const state: StepState = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <Fragment key={label}>
            {index > 0 ? (
              <View
                style={[styles.line, { backgroundColor: index <= current ? colors.primary : colors.border }]}
              />
            ) : null}
            <View style={styles.step}>
              <View style={[styles.circle, circleStyles[state]]}>
                {state === 'done' ? (
                  <Icon name="check" size={18} color={colors.white} />
                ) : (
                  <Text variant="captionMedium" color={state === 'current' ? 'white' : 'subtle'}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                variant="micro"
                numberOfLines={1}
                style={[
                  styles.label,
                  {
                    color:
                      state === 'todo'
                        ? colors.textSubtle
                        : state === 'current'
                          ? colors.primary
                          : colors.text,
                  },
                ]}
              >
                {label.toUpperCase()}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

const circleStyles = StyleSheet.create({
  current: { backgroundColor: colors.primary, borderColor: colors.primarySoft, borderWidth: 4 },
  done: { backgroundColor: colors.primary },
  todo: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5 },
});

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    borderRadius: CIRCLE / 2,
    height: CIRCLE,
    justifyContent: 'center',
    width: CIRCLE,
  },
  label: { letterSpacing: 0.6 },
  line: {
    flex: 1,
    height: 2,
    marginHorizontal: -(COLUMN - CIRCLE) / 2,
    marginTop: CIRCLE / 2 - 1,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  step: { alignItems: 'center', gap: 8, width: COLUMN },
});
