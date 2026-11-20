import { formatDayET, fromLocal, type Quote } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const CONTACT = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email' } as const;

/** What the customer sent: the lines, files, needed-by, delivery or pickup, contact and notes. */
export function QuoteRequestCard({ quote, now }: { quote: Quote; now: number }) {
  const request = quote.request;
  const needed =
    request.neededBy.kind === 'asap'
      ? 'ASAP'
      : request.neededBy.kind === 'this_week'
        ? 'This week'
        : request.neededBy.date
          ? formatDayET(fromLocal(request.neededBy.date, 12 * 60), now)
          : 'By a date';
  return (
    <Card style={styles.card}>
      <Text variant="heading" accessibilityRole="header">
        Your list
      </Text>
      {request.lines.map((line, index) => (
        <View key={`${index}-${line.text}`} style={styles.row}>
          <Text style={styles.flex}>{line.text}</Text>
          {line.quantity != null ? <Text variant="bodyMedium">× {line.quantity}</Text> : null}
        </View>
      ))}
      {request.attachments.map((file) => (
        <View key={file.path} style={styles.row} accessible>
          <Icon name="paperclip" size={14} color={colors.textMuted} />
          <Text variant="caption" color="muted" style={styles.flex} numberOfLines={1}>
            {file.name}
          </Text>
        </View>
      ))}
      <Text variant="caption" color="muted">
        Needed {needed === 'This week' ? 'this week' : needed === 'ASAP' ? 'ASAP' : `by ${needed}`} ·{' '}
        {request.fulfilment === 'pickup'
          ? 'Pickup'
          : `Delivery to ${request.jobsite?.label ?? 'your jobsite'}`}{' '}
        · {CONTACT[request.contact.preferred]}
      </Text>
      {request.notes ? <Text variant="caption">{request.notes}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  flex: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
});
