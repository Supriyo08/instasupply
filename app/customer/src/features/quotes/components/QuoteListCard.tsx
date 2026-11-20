import { formatDayET, formatMoney, type Quote } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, StatusPill, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { QUOTE_STATUS, quoteStatusOf, requestSummary, respondByText, validityText } from '../quote-format';

/** A material list or quote in a list: number, date, what was asked, status and the quoted total. */
export const QuoteListCard = memo(function QuoteListCard({ quote, now }: { quote: Quote; now: number }) {
  const status = quoteStatusOf(quote, now);
  const meta = QUOTE_STATUS[status];
  const note =
    respondByText(quote, now) ?? (status === 'quoted' ? validityText(quote.offerValidUntil, now) : null);
  return (
    <Card
      onPress={() => router.push(`/quotes/${quote.id}`)}
      accessibilityLabel={`Material list ${quote.number}, ${meta.label}. Opens the quote.`}
      style={styles.card}
    >
      <View style={styles.top}>
        <View style={styles.icon}>
          <Icon name="clipboard" size={20} color={colors.primaryDark} />
        </View>
        <View style={styles.title}>
          <Text variant="heading">{quote.number}</Text>
          <Text variant="caption" color="muted">
            Sent {formatDayET(quote.createdAt, now)} ·{' '}
            {quote.request.fulfilment === 'pickup' ? 'Pickup' : (quote.request.jobsite?.label ?? 'Delivery')}
          </Text>
        </View>
        {quote.offer ? (
          <Text variant="heading" color="primaryDark">
            {formatMoney(quote.offer.pricing.totalCents)}
          </Text>
        ) : null}
      </View>
      <StatusPill label={meta.label} tone={meta.tone} />
      <Text variant="caption" color="muted" numberOfLines={2}>
        {requestSummary(quote)}
      </Text>
      {note ? (
        <Text variant="captionMedium" color={status === 'quoted' ? 'primaryDark' : 'muted'}>
          {note}
        </Text>
      ) : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { gap: spacing.sm + 2 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  title: { flex: 1 },
  top: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
