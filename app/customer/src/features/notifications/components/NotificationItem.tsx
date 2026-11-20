import { formatRelativeTime, type AppNotification, type NotificationType } from '@instasupply/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing, statusTones, type StatusTone } from '@/theme/tokens';

const TYPE_STYLES: Partial<Record<NotificationType, { icon: IconName; tone: StatusTone }>> = {
  order_placed: { icon: 'shopping-bag', tone: 'success' },
  order_update: { icon: 'truck', tone: 'info' },
  order_store_update: { icon: 'package', tone: 'info' },
  order_delivered: { icon: 'check-circle', tone: 'success' },
  order_cancelled: { icon: 'x-circle', tone: 'danger' },
  pickup_ready: { icon: 'key', tone: 'success' },
  refund_issued: { icon: 'rotate-ccw', tone: 'success' },
  quote_update: { icon: 'clipboard', tone: 'info' },
  issue_update: { icon: 'alert-circle', tone: 'warning' },
  support_reply: { icon: 'message-circle', tone: 'info' },
  account_suspended: { icon: 'slash', tone: 'danger' },
  test: { icon: 'bell', tone: 'warning' },
  system: { icon: 'info', tone: 'neutral' },
};
const FALLBACK: { icon: IconName; tone: StatusTone } = { icon: 'bell', tone: 'neutral' };

/** Inbox row: icon by type, title, body, relative time and an unread dot. */
export const NotificationItem = memo(function NotificationItem({
  item,
  now,
  opens,
  onPress,
}: {
  item: AppNotification;
  now: number;
  /** What a tap opens, for the screen-reader hint ("Opens the order"); null when it only marks read. */
  opens: string | null;
  onPress: (item: AppNotification) => void;
}) {
  const style = TYPE_STYLES[item.type] ?? FALLBACK;
  const tone = statusTones[style.tone];
  const time = formatRelativeTime(item.createdAt, now);
  const unread = !item.read;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body}. ${time}`}
      accessibilityHint={opens ?? (unread ? 'Marks it as read' : undefined)}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, unread ? styles.unread : null, pressed ? styles.pressed : null]}
    >
      <View style={[styles.icon, { backgroundColor: tone.background }]}>
        <Icon name={style.icon} size={20} color={tone.foreground} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant={unread ? 'heading' : 'bodyMedium'} numberOfLines={1} style={styles.title}>
            {item.title}
          </Text>
          <Text variant="micro" color={unread ? 'primaryDark' : 'subtle'}>
            {time}
          </Text>
          {unread ? <View style={styles.dot} /> : null}
        </View>
        <Text variant="caption" color="muted" numberOfLines={3}>
          {item.body}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  body: { flex: 1, gap: 2 },
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 14,
    padding: spacing.lg,
  },
  dot: { backgroundColor: colors.primary, borderRadius: 4, height: 8, width: 8 },
  icon: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  pressed: { opacity: 0.75 },
  title: { flex: 1 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  unread: { borderColor: colors.primaryLight, borderWidth: 1 },
});
