import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** Search history (tap to search again, remove one, or clear all); a short tip when it is empty. */
export function RecentSearches({
  loaded,
  items,
  onSelect,
  onRemove,
  onClear,
}: {
  loaded: boolean;
  items: string[];
  onSelect: (term: string) => void;
  onRemove: (term: string) => void;
  onClear: () => void;
}) {
  if (!loaded) return null;

  if (items.length === 0) {
    return (
      <View style={styles.tip}>
        <View style={styles.tipIcon}>
          <Icon name="search" size={18} color={colors.primary} />
        </View>
        <View style={styles.tipText}>
          <Text variant="bodyMedium">Find it across local suppliers</Text>
          <Text variant="caption" color="muted">
            Search by product, size or trade word. Your recent searches will show up here.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text variant="heading">Recent searches</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all recent searches"
          hitSlop={8}
          onPress={onClear}
        >
          <Text variant="captionMedium" color="primary">
            Clear all
          </Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        {items.map((item, index) => (
          <View key={item} style={[styles.row, index > 0 ? styles.divider : null]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Search for ${item}`}
              onPress={() => onSelect(item)}
              style={({ pressed }) => [styles.term, pressed ? styles.pressed : null]}
            >
              <Icon name="clock" size={16} color={colors.textMuted} />
              <Text numberOfLines={1} style={styles.termText}>
                {item}
              </Text>
            </Pressable>
            <IconButton
              icon="x"
              label={`Remove ${item} from recent searches`}
              size={32}
              color={colors.textSubtle}
              onPress={() => onRemove(item)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  pressed: { opacity: 0.6 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 48 },
  section: { gap: spacing.md },
  term: { alignItems: 'center', alignSelf: 'stretch', flex: 1, flexDirection: 'row', gap: spacing.md },
  termText: { flex: 1 },
  tip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  tipIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  tipText: { flex: 1, gap: 2 },
});
