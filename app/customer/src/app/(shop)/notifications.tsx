import { describeError } from '@instasupply/expo-firebase';
import type { AppNotification } from '@instasupply/shared';
import { router, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Header, IconButton, Screen, Text } from '@/components/ui';
import { markAllRead, markRead, notificationHref, useNotifications } from '@/features/notifications/hooks';
import { groupByDay } from '@/features/orders/components/notification-groups';
import { NotificationItem } from '@/features/orders/components/NotificationItem';
import { SkeletonList } from '@/features/orders/components/Skeletons';
import { useNow } from '@/features/orders/components/useNow';
import { useCustomer } from '@/features/session/SessionProvider';
import { notify } from '@/lib/notify';
import { colors, radius, spacing } from '@/theme/tokens';

const INBOX_HREF = '/notifications';

/** Notifications inbox: order updates grouped by day, tap to open the order, "Mark all read". */
export default function NotificationsScreen() {
  return (
    <Screen
      header={
        <Header
          title="Notifications"
          right={
            <IconButton
              icon="settings"
              label="Notification settings"
              onPress={() => router.push('/settings')}
            />
          }
        />
      }
      scroll={false}
      contentStyle={styles.body}
    >
      <Inbox />
    </Screen>
  );
}

function Inbox() {
  const { user } = useCustomer();
  const { data, loading, error, retry, unread } = useNotifications(user.uid);
  const now = useNow(60_000);
  const insets = useSafeAreaInsets();
  const [markingAll, setMarkingAll] = useState(false);
  const sections = useMemo(() => groupByDay(data, now), [data, now]);

  const open = useCallback((item: AppNotification) => {
    if (!item.read) void markRead(item.id).catch(() => undefined);
    const href = notificationHref(item.data);
    if (href !== INBOX_HREF) router.push(href as Href);
  }, []);

  const readAll = async () => {
    setMarkingAll(true);
    try {
      await markAllRead(data);
    } catch (cause) {
      notify("Couldn't update notifications", describeError(cause));
    } finally {
      setMarkingAll(false);
    }
  };

  if (loading && data.length === 0) {
    return (
      <View style={styles.padded}>
        <SkeletonList count={5} circle={44} lines={2} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.padded}>
        <ErrorState title="Couldn't load notifications" error={error} onRetry={retry} />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <NotificationItem
          item={item}
          now={now}
          opensOrder={notificationHref(item.data) !== INBOX_HREF}
          onPress={open}
        />
      )}
      renderSectionHeader={({ section }) => (
        <Text variant="captionMedium" color="muted" style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      ListHeaderComponent={
        data.length > 0 ? (
          <View style={styles.summary}>
            <View style={styles.summaryText}>
              <Text variant="heading">{unread > 0 ? `${unread} unread` : "You're all caught up"}</Text>
              <Text variant="caption" color="muted">
                {unread > 0 ? 'Tap an update to see your order' : "We'll let you know as your orders move"}
              </Text>
            </View>
            {unread > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications as read"
                accessibilityState={{ disabled: markingAll, busy: markingAll }}
                disabled={markingAll}
                hitSlop={8}
                onPress={() => void readAll()}
                style={({ pressed }) => [styles.markAll, pressed ? styles.pressed : null]}
              >
                {markingAll ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text variant="captionMedium" style={styles.markAllLabel}>
                    Mark all read
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
      ItemSeparatorComponent={Gap}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxxl }]}
      ListEmptyComponent={
        <EmptyState
          art="scene-jobsite-delivery"
          title="No notifications yet"
          message="We'll keep you posted here when your order is confirmed, packed and on its way."
        />
      }
    />
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  body: { paddingTop: 0 },
  gap: { height: spacing.sm + 2 },
  list: { flexGrow: 1, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  markAll: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 110,
    paddingHorizontal: spacing.md,
  },
  markAllLabel: { color: colors.primaryDark },
  padded: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  pressed: { opacity: 0.7 },
  sectionTitle: {
    letterSpacing: 0.4,
    paddingBottom: spacing.sm,
    paddingTop: spacing.lg,
    textTransform: 'uppercase',
  },
  summary: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  summaryText: { flex: 1, gap: 1 },
});
