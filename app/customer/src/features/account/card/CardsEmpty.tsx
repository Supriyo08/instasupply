import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Empty "My Cards": a dashed ghost card inviting the first card. */
export function CardsEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add your first card"
        onPress={onAdd}
        style={({ pressed }) => [styles.ghost, pressed ? styles.pressed : null]}
      >
        <View style={styles.chip} />
        <View style={styles.plus}>
          <Icon name="plus" size={26} color={colors.primary} />
        </View>
        <View style={styles.lines}>
          <View style={[styles.line, styles.lineLong]} />
          <View style={[styles.line, styles.lineShort]} />
        </View>
      </Pressable>
      <Text variant="title" align="center">
        No saved cards yet
      </Text>
      <Text color="muted" align="center" style={styles.message}>
        Save a card once and pay in a tap at checkout. You can also pay cash on delivery.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.sm,
    height: 26,
    left: 22,
    position: 'absolute',
    top: 22,
    width: 36,
  },
  ghost: {
    alignItems: 'center',
    alignSelf: 'center',
    aspectRatio: 1.8,
    backgroundColor: colors.surface,
    borderColor: colors.primaryLight,
    borderRadius: radius.lg,
    borderStyle: 'dashed',
    borderWidth: 2,
    justifyContent: 'center',
    marginBottom: 12,
    maxWidth: 420,
    width: '100%',
  },
  line: { backgroundColor: colors.background, borderRadius: radius.pill, height: 8 },
  lineLong: { width: '62%' },
  lineShort: { width: '34%' },
  lines: { bottom: 22, gap: 8, left: 22, position: 'absolute', right: 22 },
  message: { maxWidth: 300 },
  plus: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  pressed: { opacity: 0.8 },
  wrap: { alignItems: 'center', gap: 6, paddingVertical: 12 },
});
