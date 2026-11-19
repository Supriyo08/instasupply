import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** The home screen's search field: looks like an input, opens the search screen. */
export function SearchBarButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search products"
      accessibilityHint="Opens product search"
      onPress={() => router.push('/search')}
      style={({ pressed }) => [styles.bar, pressed ? styles.pressed : null]}
    >
      <Icon name="search" size={20} color={colors.textMuted} />
      <Text color="muted" numberOfLines={1} style={styles.placeholder}>
        Search keywords..
      </Text>
      <Icon name="sliders" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    height: 52,
    paddingHorizontal: spacing.lg,
  },
  placeholder: { flex: 1 },
  pressed: { opacity: 0.75 },
});
