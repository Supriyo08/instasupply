import { formatRelativeTime, type AppNotification } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Icon, Screen, Text, type IconName } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { markAllRead, markRead, notificationHref, useNotifications } from '@/features/notifications/hooks';
import { useTheme } from '@/theme/ThemeProvider';

const ICONS: Partial<Record<AppNotification['type'], IconName>> = {
  delivery_assigned: 'cube',
  delivery_unassigned: 'swap-horizontal',
  delivery_cancelled: 'close-circle',
  delivery_updated: 'create',
  chat_message: 'chatbubble',
  account_approved: 'shield-checkmark',
  test: 'notifications',
};

export default function NotificationsScreen() {
  const { user } = useDriver();
  const { colors } = useTheme();
  const { data, loading, unread } = useNotifications(user.uid);

  const open = (item: AppNotification) => {
    if (!item.read) void markRead(item.id).catch(() => undefined);
    const href = notificationHref({ ...item.data, type: item.type });
    if (href && href !== '/notifications') router.push(href as never);
  };

  return (
    <Screen edges={[]}>
      {unread > 0 ? (
        <Button
          label={`Mark all ${unread} as read`}
          variant="ghost"
          icon="checkmark-done"
          onPress={() => void markAllRead(data)}
        />
      ) : null}
      {!loading && data.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="You're all caught up"
          message="New assignments and messages will appear here."
        />
      ) : null}
      {data.map((item) => (
        <Card key={item.id} onPress={() => open(item)} accent={item.read ? undefined : colors.primary}>
          <View style={styles.row}>
            <View
              style={[styles.icon, { backgroundColor: item.read ? colors.surfaceMuted : colors.primarySoft }]}
            >
              <Icon
                name={ICONS[item.type] ?? 'notifications'}
                size={18}
                color={item.read ? colors.textSubtle : colors.primary}
              />
            </View>
            <View style={styles.flex}>
              <Text variant={item.read ? 'body' : 'bodyStrong'}>{item.title}</Text>
              <Text variant="caption" color="muted">
                {item.body}
              </Text>
              <Text variant="caption" color="subtle">
                {formatRelativeTime(item.createdAt)}
              </Text>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  icon: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  row: { flexDirection: 'row', gap: 12 },
});
