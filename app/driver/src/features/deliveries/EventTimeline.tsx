import { formatDateTime, type DeliveryEvent } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export function EventTimeline({ events }: { events: DeliveryEvent[] }) {
  const { colors } = useTheme();
  if (events.length === 0) {
    return (
      <Text variant="caption" color="subtle">
        No activity yet.
      </Text>
    );
  }
  return (
    <View>
      {events.map((event, index) => (
        <View key={event.id} style={styles.item}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: index === 0 ? colors.primary : colors.border }]} />
            {index < events.length - 1 ? (
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            ) : null}
          </View>
          <View style={styles.content}>
            <Text variant={index === 0 ? 'bodyStrong' : 'body'}>{event.message}</Text>
            <Text variant="caption" color="subtle">
              {formatDateTime(event.at)}
              {event.actorName && event.actorRole !== 'system' ? ` · ${event.actorName}` : ''}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 2, paddingBottom: 14 },
  dot: { borderRadius: 6, height: 12, marginTop: 4, width: 12 },
  item: { flexDirection: 'row', gap: 12 },
  line: { flex: 1, marginTop: 2, width: 2 },
  rail: { alignItems: 'center', width: 12 },
});
