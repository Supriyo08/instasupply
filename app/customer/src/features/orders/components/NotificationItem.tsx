import { formatRelativeTime, type AppNotification, type NotificationType } from '@instasupply/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { TONES, type Tone } from './order-ui';

const TYPE_STYLES: Partial<Record<NotificationType, { icon: IconName; tone: Tone }>> = {
  order_placed: { icon: 'shopping-bag', tone: 'brand' },
  order_update: { icon: 'truck', tone: 'info' },
  order_delivered: { icon: 'check-circle', tone: 'success' },
  order_cancelled: { icon: 'x-circle', tone: 'danger' },
  test: { icon: 'bell', tone: 'warning' },
  system: { icon: 'info', tone: 'neutral' },
};
const FALLBACK: { icon: IconName; tone: Tone } = { icon: 'bell', tone: 'neutral' };

/** Inbox row: icon by type, title, body, relative time and an unread dot. */
export const NotificationItem = memo(function NotificationItem({
  item,
  now,
  opensOrder,
  onPress,
}: {
  item: AppNotification;
  now: number;
  opensOrder: boolean;
  onPress: (item: AppNotification) => void;
}) {
  const style = TYPE_STYLES[item.type] ?? FALLBACK;
  const tone = TONES[style.tone];
  const time = formatRelativeTime(item.createdAt, now);
  const unread = !item.read;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body}. ${time}`}
      accessibilityHint={opensOrder ? 'Opens the order' : unread ? 'Marks it as read' : undefined}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={[styles.icon, { backgroundColor: tone.bg }]}>
        <Icon name={style.icon} size={20} color={tone.fg} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant={unread ? 'heading' : 'bodyMedium'} numberOfLines={1} style={styles.title}>
            {item.title}
          </Text>
          <Text variant="micro" color={unread ? 'primary' : 'subtle'}>
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
});
