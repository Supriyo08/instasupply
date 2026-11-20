import { describeError } from '@instasupply/api-client';
import type { AppNotification } from '@instasupply/shared';
import { router, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Header, IconButton, Text, webColumn } from '@/components/ui';
import { groupByDay } from '@/features/notifications/components/notification-groups';
import { NotificationItem } from '@/features/notifications/components/NotificationItem';
import {
  notificationData,
  notificationHref,
  useNotificationActions,
  useNotifications,
} from '@/features/notifications/hooks';
import { SkeletonList } from '@/features/orders/components/Skeletons';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useNow } from '@/hooks/useNow';
import { notify } from '@/lib/notify';
import { colors, radius, spacing } from '@/theme/tokens';

const INBOX_HREF = '/notifications';

const OPENS: Record<string, string> = {
  issues: 'Opens the case',
  quotes: 'Opens the quote',
  support: 'Opens the support chat',
  orders: 'Opens the order',
};

/** What a tapped notification opens, for the hint; null when it stays in the inbox. */
function opensHint(href: string): string | null {
  if (href === INBOX_HREF) return null;
  if (href.includes('/track/')) return 'Opens live tracking';
  return OPENS[href.split('/')[1] ?? ''] ?? null;
}

/** Inbox 🔒 (MARKETPLACE §7.3): newest 50, grouped by day; a tap marks read and follows the deep link. */
export default function NotificationsScreen() {
  return (
    <RequireAccount title="Notifications">
      <View style={styles.fill}>
        <Header
          title="Notifications"
          right={
            <IconButton
              icon="sliders"
              label="Notification settings"
              onPress={() => router.push('/settings')}
            />
          }
        />
        <Inbox />
      </View>
    </RequireAccount>
  );
}

function Inbox() {
  const { user } = useCustomer();
  const inbox = useNotifications(user.uid);
  const { markRead, markAllRead } = useNotificationActions(user.uid);
  const now = useNow(60_000);
  const insets = useSafeAreaInsets();
  const sections = useMemo(() => groupByDay(inbox.data, now), [inbox.data, now]);

  const open = useCallback(
    (item: AppNotification) => {
      if (!item.read) void markRead.run(item.id).catch(() => undefined);
      const href = notificationHref(notificationData(item));
      if (href !== INBOX_HREF) router.push(href as Href);
    },
    [markRead],
  );

  const readAll = async () => {
    try {
      await markAllRead.run();
    } catch (cause) {
      notify("Couldn't update notifications", describeError(cause));
    }
  };

  if (inbox.loading && inbox.data.length === 0) {
    return (
      <View style={[styles.padded, webColumn]}>
        <SkeletonList count={5} circle={44} lines={2} />
      </View>
    );
  }
  if (inbox.error && inbox.data.length === 0) {
    return (
      <View style={[styles.padded, webColumn]}>
        <ErrorState title="Couldn't load notifications" error={inbox.error} onRetry={inbox.retry} />
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
          opens={opensHint(notificationHref(notificationData(item)))}
          onPress={open}
        />
      )}
      renderSectionHeader={({ section }) => (
        <Text variant="captionMedium" color="muted" style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      ListHeaderComponent={
        inbox.data.length > 0 ? (
          <View style={styles.summary}>
            <View style={styles.summaryText}>
              <Text variant="heading">
                {inbox.unread > 0 ? `${inbox.unread} unread` : "You're all caught up"}
              </Text>
              <Text variant="caption" color="muted">
                {inbox.unread > 0
                  ? 'Tap an update to open the order, quote or case'
                  : "We'll let you know as your orders move"}
              </Text>
            </View>
            {inbox.unread > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications as read"
                accessibilityState={{ disabled: markAllRead.busy, busy: markAllRead.busy }}
                disabled={markAllRead.busy}
                hitSlop={8}
                onPress={() => void readAll()}
                style={({ pressed }) => [styles.markAll, pressed ? styles.pressed : null]}
              >
                {markAllRead.busy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text variant="captionMedium" color="primaryDark">
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
      refreshControl={
        <RefreshControl refreshing={inbox.refreshing} onRefresh={inbox.retry} tintColor={colors.primary} />
      }
      contentContainerStyle={[styles.list, webColumn, { paddingBottom: insets.bottom + spacing.xxxl }]}
      ListEmptyComponent={
        <EmptyState
          art="scene-jobsite-delivery"
          title="No notifications yet"
          message="We'll keep you posted here when a store confirms, your load is packed and the truck is on its way."
        />
      }
    />
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  fill: { backgroundColor: colors.background, flex: 1 },
  gap: { height: spacing.sm + 2 },
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  markAll: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    minWidth: 104,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  padded: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  pressed: { opacity: 0.7 },
  sectionTitle: {
    letterSpacing: 0.3,
    paddingBottom: spacing.sm,
    paddingHorizontal: 2,
    paddingTop: spacing.lg,
    textTransform: 'uppercase',
  },
  summary: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  summaryText: { flex: 1 },
});
