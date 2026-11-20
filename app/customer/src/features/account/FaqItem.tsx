import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import type { FaqEntry } from './faq';

/** One question that opens to its answer. */
export function FaqItem({ entry, first }: { entry: FaqEntry; first: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={first ? null : styles.divider}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={entry.question}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <Text variant="bodyMedium" style={styles.question}>
          {entry.question}
        </Text>
        <Icon name={open ? 'minus' : 'plus'} size={18} color={colors.primaryDark} />
      </Pressable>
      {open ? (
        <Text color="muted" style={styles.answer}>
          {entry.answer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { backgroundColor: colors.surfaceMuted },
  question: { flex: 1 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
