import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

export interface MenuItem {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  /** `danger` renders the row in red without a chevron (Sign out). */
  tone?: 'default' | 'danger';
  /** Short text shown before the chevron. */
  value?: string;
  /** Red counter pill (e.g. unread notifications). */
  count?: number;
  busy?: boolean;
}

/** White card of Big Cart menu rows: line icon on a soft circle, label, chevron. */
export function MenuGroup({ title, items }: { title?: string; items: MenuItem[] }) {
  return (
    <View style={styles.group}>
      {title ? (
        <Text variant="captionMedium" color="muted" style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.card}>
        {items.map((item, index) => (
          <View key={item.key}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <MenuRow item={item} />
          </View>
        ))}
      </View>
    </View>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  const danger = item.tone === 'danger';
  const tint = danger ? colors.danger : colors.primary;
  const count = item.count && item.count > 0 ? item.count : 0;
  const a11yLabel = [item.label, count ? `${count} unread` : null, item.value].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled: !!item.busy, busy: !!item.busy }}
      disabled={item.busy}
      onPress={item.onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={[styles.icon, { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft }]}>
        <Icon name={item.icon} size={18} color={tint} />
      </View>
      <Text variant="bodyMedium" color={danger ? 'danger' : 'default'} numberOfLines={1} style={styles.label}>
        {item.label}
      </Text>
      {count ? (
        <View style={styles.count}>
          <Text variant="micro" color="white">
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
      {item.value ? (
        <Text variant="caption" color="muted" numberOfLines={1}>
          {item.value}
        </Text>
      ) : null}
      {item.busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : danger ? null : (
        <Icon name="chevron-right" size={20} color={colors.textSubtle} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  count: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 6,
  },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginLeft: 66 },
  group: { gap: 8 },
  icon: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  label: { flex: 1 },
  pressed: { backgroundColor: colors.surfaceMuted },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { letterSpacing: 0.3, paddingHorizontal: 4, textTransform: 'uppercase' },
});
