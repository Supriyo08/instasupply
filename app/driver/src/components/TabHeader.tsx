import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Icon, Text } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { useNotifications } from '@/features/notifications/hooks';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The header of every tab (Jobs, Today, Route, Earnings, Dispatch): title, optional subtitle, the
 * notifications bell with the unread count, and the avatar that opens `(app)/profile` (MARKETPLACE §10).
 */
export function TabHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const { user, profile } = useDriver();
  const { unread } = useNotifications(user.uid);
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text variant="caption" color="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onPress={() => router.push('/notifications')}
        hitSlop={8}
        style={styles.bell}
      >
        <Icon name="notifications-outline" size={24} color={colors.text} />
        {unread > 0 ? (
          <View style={[styles.dot, { backgroundColor: colors.danger, borderColor: colors.background }]}>
            <Text variant="micro" style={{ color: colors.onPrimary }}>
              {unread > 9 ? '9+' : unread}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={() => router.push('/profile')}
        hitSlop={8}
      >
        <Avatar name={profile.displayName} size={36} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bell: { padding: 4 },
  dot: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -4,
    top: -2,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingBottom: 8 },
  text: { flex: 1, gap: 2 },
});
