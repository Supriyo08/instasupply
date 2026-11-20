import { formatClock, type SupportContext, type SupportMessage } from '@instasupply/shared';
import { router, type Href } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** Where a context chip leads: the order, the store order's order, the quote or the case. */
export function contextHref(context: SupportContext): Href | null {
  switch (context.kind) {
    case 'order':
      return `/orders/${context.id}`;
    case 'store_order': {
      // A store order id is `{orderId}-{letter}`.
      const orderId = context.id.replace(/-[A-Z]$/, '');
      return `/orders/${orderId}`;
    }
    case 'quote':
      return `/quotes/${context.id}`;
    case 'issue':
      return `/issues/${context.id}`;
    default:
      return null;
  }
}

/** A context chip ("About IS-10042") that opens what it is about. */
export function ContextChip({ context, onRemove }: { context: SupportContext; onRemove?: () => void }) {
  const href = contextHref(context);
  return (
    <View style={styles.chip}>
      <Pressable
        accessibilityRole={href ? 'link' : 'text'}
        accessibilityLabel={context.label}
        disabled={!href}
        onPress={() => (href ? router.push(href) : undefined)}
        style={styles.chipBody}
        hitSlop={4}
      >
        <Icon name="link-2" size={12} color={colors.primaryDark} />
        <Text variant="micro" color="primaryDark" numberOfLines={1}>
          {context.label}
        </Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove topic"
          onPress={onRemove}
          hitSlop={8}
        >
          <Icon name="x" size={12} color={colors.primaryDark} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One chat message: mine on the right in green, the team's on the left in white. */
export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  pending,
}: {
  message: SupportMessage;
  mine: boolean;
  pending: boolean;
}) {
  const time = pending ? 'Sending…' : formatClock(message.createdAt);
  return (
    <View style={[styles.row, mine ? styles.mineRow : null]}>
      <View
        style={[styles.bubble, mine ? styles.mine : styles.theirs]}
        accessible
        accessibilityLabel={`${mine ? 'You' : message.senderName}: ${message.text}. ${time}`}
      >
        {!mine ? (
          <Text variant="micro" color="primaryDark">
            {message.senderName || 'InstaSupply'}
          </Text>
        ) : null}
        {message.context ? <ContextChip context={message.context} /> : null}
        <Text color={mine ? 'white' : 'default'}>{message.text}</Text>
        <Text variant="micro" color={mine ? 'white' : 'subtle'} align="right" style={styles.time}>
          {time}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bubble: { borderRadius: radius.lg, gap: 4, maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10 },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipBody: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 4 },
  mine: { backgroundColor: colors.primaryDark, borderBottomRightRadius: radius.sm },
  mineRow: { justifyContent: 'flex-end' },
  row: { flexDirection: 'row' },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: radius.sm },
  time: { opacity: 0.8 },
});
