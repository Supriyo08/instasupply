import type { TimestampLike } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { dayAndClock } from '../order-format';

export interface TimelineItem {
  key: string;
  label: string;
  at: TimestampLike | null;
  state: 'done' | 'current' | 'todo' | 'problem';
}

const DOT = 22;

/** Vertical status steps with times (store orders, quotes). Done steps are green, the current one rings. */
export function Timeline({ steps, now }: { steps: readonly TimelineItem[]; now: number }) {
  return (
    <View accessibilityRole="list">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const time = step.at != null ? dayAndClock(step.at, now) : null;
        const stateWord =
          step.state === 'done'
            ? 'done'
            : step.state === 'current'
              ? 'in progress'
              : step.state === 'problem'
                ? ''
                : 'to come';
        return (
          <View
            key={step.key}
            style={styles.row}
            accessible
            accessibilityLabel={[step.label, stateWord, time].filter(Boolean).join(', ')}
          >
            <View style={styles.rail}>
              <Dot state={step.state} />
              {!last ? (
                <View
                  style={[
                    styles.line,
                    { backgroundColor: step.state === 'done' ? colors.primary : colors.border },
                  ]}
                />
              ) : null}
            </View>
            <View style={[styles.text, last ? null : styles.gap]}>
              <Text
                variant={step.state === 'current' ? 'heading' : 'bodyMedium'}
                color={step.state === 'todo' ? 'subtle' : step.state === 'problem' ? 'danger' : 'default'}
              >
                {step.label}
              </Text>
              {time ? (
                <Text variant="caption" color="muted">
                  {time}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Dot({ state }: { state: TimelineItem['state'] }) {
  if (state === 'done') {
    return (
      <View style={[styles.dot, { backgroundColor: colors.primary }]}>
        <Icon name="check" size={13} color={colors.white} />
      </View>
    );
  }
  if (state === 'problem') {
    return (
      <View style={[styles.dot, { backgroundColor: colors.danger }]}>
        <Icon name="alert-triangle" size={12} color={colors.white} />
      </View>
    );
  }
  return <View style={[styles.dot, state === 'current' ? styles.current : styles.todo]} />;
}

const styles = StyleSheet.create({
  current: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderWidth: 5 },
  dot: { alignItems: 'center', borderRadius: DOT / 2, height: DOT, justifyContent: 'center', width: DOT },
  gap: { paddingBottom: spacing.lg },
  line: { flex: 1, marginVertical: 2, width: 2 },
  rail: { alignItems: 'center', width: DOT },
  row: { flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: 1, paddingTop: 1 },
  todo: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 2 },
});
