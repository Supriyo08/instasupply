import { formatRelativeTime, type AppNotification } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Screen,
  Skeleton,
  Text,
  type IconName,
} from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { useDriver } from '@/features/auth/SessionProvider';
import { notify } from '@/features/deliveries/useDeliveryAction';
import {
  hrefForNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from '@/features/notifications/hooks';
import { describeError } from '@/lib/api';
import { useNow } from '@/lib/use-now';
import { useTheme } from '@/theme/ThemeProvider';

const ICONS: Partial<Record<AppNotification['type'], IconName>> = {
  delivery_assigned: 'cube',
  delivery_unassigned: 'swap-horizontal',
  delivery_cancelled: 'close-circle',
  delivery_updated: 'create',
  delivery_failed: 'alert-circle',
  delivery_delivered: 'checkmark-circle',
  chat_message: 'chatbubble',
  job_offer: 'briefcase',
  job_update: 'briefcase',
  payout_sent: 'wallet',
  vehicle_review: 'car',
  account_approved: 'shield-checkmark',
  account_suspended: 'lock-closed',
  test: 'notifications',
};

/**
 * The inbox (CLIENTS §4.6: `queries.notifications(uid)`, live through `user:{uid}:notifications`).
 * Mark read is optimistic (§1.12); a row opens where its push would (§6.4).
 */
export default function NotificationsScreen() {
  const { user } = useDriver();
  const { colors } = useTheme();
  const { data, loading, error, retry, refreshing, unread } = useNotifications(user.uid);
  const markRead = useMarkRead(user.uid);
  const markAllRead = useMarkAllRead(user.uid);
  const now = useNow();

  const open = (item: AppNotification) => {
    // Optimistic: the row turns read at once; a failure puts it back (the hook rolls back).
    if (!item.read) void markRead.run(item.id).catch(() => undefined);
    const href = hrefForNotification(item);
    if (href !== '/notifications') router.push(href);
  };

  const readAll = () => {
    markAllRead.run().catch((cause: unknown) => notify("Couldn't mark them read", describeError(cause)));
  };

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={retry}>
      {unread > 0 ? (
        <View style={styles.toolbar}>
          <Text variant="caption" color="muted" accessibilityLiveRegion="polite">
            {unread} unread
          </Text>
          <Button
            label="Mark all as read"
            variant="ghost"
            icon="checkmark-done"
            loading={markAllRead.busy}
            onPress={readAll}
          />
        </View>
      ) : null}
      {error ? <ErrorState error={error} onRetry={retry} title="Couldn't load your notifications" /> : null}
      {loading && data.length === 0 ? (
        <View style={styles.list} accessibilityLabel="Loading notifications">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} height={72} radius={16} />
          ))}
        </View>
      ) : null}
      {!loading && !error && data.length === 0 ? (
        <>
          <SceneArt scene="scene-local-suppliers" height={150} />
          <EmptyState
            icon="notifications-off-outline"
            title="You're all caught up"
            message="New jobs near you, assignments from dispatch and payouts show up here."
          />
        </>
      ) : null}
      {data.map((item) => (
        <Card
          key={item.id}
          onPress={() => open(item)}
          accent={item.read ? undefined : colors.primary}
          accessibilityLabel={[
            item.read ? null : 'Unread',
            item.title,
            item.body,
            formatRelativeTime(item.createdAt, now),
          ]
            .filter(Boolean)
            .map((part) => String(part).replace(/[.!?]+$/, ''))
            .join('. ')}
        >
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
                {formatRelativeTime(item.createdAt, now)}
              </Text>
            </View>
            {item.read ? null : <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: 4, height: 8, marginTop: 6, width: 8 },
  flex: { flex: 1, gap: 2 },
  icon: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  list: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  toolbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
