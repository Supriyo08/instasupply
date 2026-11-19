import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Skeleton, Text, type IconName } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

export interface AccountStat {
  key: string;
  icon: IconName;
  label: string;
  /** null while loading; NaN when it could not be loaded. */
  value: number | null;
  onPress: () => void;
}

/** Three quick-glance tiles under the profile (orders, favourites, addresses). */
export function AccountStats({ stats }: { stats: AccountStat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((stat) => {
        const unknown = stat.value != null && Number.isNaN(stat.value);
        return (
          <Pressable
            key={stat.key}
            accessibilityRole="button"
            accessibilityLabel={stat.value == null || unknown ? stat.label : `${stat.label}: ${stat.value}`}
            onPress={stat.onPress}
            style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
          >
            <View style={styles.icon}>
              <Icon name={stat.icon} size={16} color={colors.primary} />
            </View>
            {stat.value == null ? (
              <Skeleton style={styles.skeleton} />
            ) : (
              <Text variant="title">{unknown ? '—' : stat.value}</Text>
            )}
            <Text variant="caption" color="muted" numberOfLines={1}>
              {stat.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    marginBottom: 4,
    width: 30,
  },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', gap: 10 },
  skeleton: { height: 22, marginVertical: 3, width: 32 },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 14,
  },
});
