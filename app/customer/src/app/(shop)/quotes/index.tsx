import type { Quote } from '@instasupply/shared';
import { router } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, EmptyState, ErrorState, Header, IconButton, webColumn } from '@/components/ui';
import { SkeletonList } from '@/features/orders/components/Skeletons';
import { QuoteListCard } from '@/features/quotes/components/QuoteListCard';
import { useCustomerQuotes } from '@/features/quotes/hooks';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useNow } from '@/hooks/useNow';
import { colors, spacing } from '@/theme/tokens';

/** Material lists & quotes 🔒 (MARKETPLACE §7.3 quotes/index): newest first, paged and live. */
export default function QuotesScreen() {
  return (
    <RequireAccount title="Material lists & quotes">
      <View style={styles.fill}>
        <Header
          title="Material lists & quotes"
          right={
            <IconButton
              icon="plus"
              label="Send a new material list"
              onPress={() => router.push('/quotes/new')}
            />
          }
        />
        <QuotesBody />
      </View>
    </RequireAccount>
  );
}

function QuotesBody() {
  const { user } = useCustomer();
  const quotes = useCustomerQuotes(user.uid);
  const now = useNow(30_000);

  if (quotes.loading && quotes.items.length === 0) {
    return (
      <View style={[styles.padded, webColumn]}>
        <SkeletonList count={3} circle={42} lines={3} />
      </View>
    );
  }
  if (quotes.error && quotes.items.length === 0) {
    return (
      <View style={[styles.padded, webColumn]}>
        <ErrorState title="Couldn't load your quotes" error={quotes.error} onRetry={quotes.retry} />
      </View>
    );
  }
  return (
    <FlatList<Quote>
      data={quotes.items}
      keyExtractor={(quote) => quote.id}
      renderItem={({ item }) => <QuoteListCard quote={item} now={now} />}
      contentContainerStyle={[styles.list, webColumn]}
      refreshControl={
        <RefreshControl refreshing={quotes.refreshing} onRefresh={quotes.retry} tintColor={colors.primary} />
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (quotes.hasMore && !quotes.loadingMore) quotes.loadMore();
      }}
      ListFooterComponent={quotes.loadingMore ? <SkeletonList count={1} circle={42} lines={2} /> : undefined}
      ListEmptyComponent={
        <EmptyState
          art="scene-material-list"
          title="Send us your material list"
          message="Type it, paste it, or upload a photo. Expect a quote within 30 minutes during business hours."
          action={<Button label="Send my list" onPress={() => router.push('/quotes/new')} />}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: { backgroundColor: colors.background, flex: 1 },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
  },
  padded: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
});
