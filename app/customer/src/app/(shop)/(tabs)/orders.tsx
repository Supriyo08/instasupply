import type { Order, Quote } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  SegmentedControl,
  Text,
  webColumn,
} from '@/components/ui';
import { OrderListCard } from '@/features/orders/components/OrderListCard';
import { SkeletonList } from '@/features/orders/components/Skeletons';
import { useCustomerOrders } from '@/features/orders/hooks';
import { useReorder } from '@/features/orders/reorder';
import { QuoteListCard } from '@/features/quotes/components/QuoteListCard';
import { useCustomerQuotes } from '@/features/quotes/hooks';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { useJobsites } from '@/features/site/hooks';
import { useNow } from '@/hooks/useNow';
import { colors, spacing } from '@/theme/tokens';

type Segment = 'active' | 'past' | 'quotes';

const SEGMENTS = [
  { value: 'active', label: 'Active' },
  { value: 'past', label: 'Past' },
  { value: 'quotes', label: 'Quotes' },
] as const;

/** Orders tab 🔒 (MARKETPLACE §7.3): Active · Past · Quotes, a jobsite filter and Reorder. */
export default function OrdersTab() {
  return (
    <RequireAccount title="Orders" message="Sign in to see your orders, deliveries and quotes.">
      <OrdersBody />
    </RequireAccount>
  );
}

function OrdersBody() {
  const { user } = useCustomer();
  const [segment, setSegment] = useState<Segment>('active');
  const [jobsiteId, setJobsiteId] = useState<string | null>(null);
  const jobsites = useJobsites(user.uid);

  return (
    <View style={styles.fill}>
      <Header title="Orders" back={false} />
      <View style={styles.controlsBar}>
        <View style={[styles.controls, webColumn]}>
          <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} />
          {segment !== 'quotes' && jobsites.data.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              accessibilityLabel="Filter by jobsite"
            >
              <Chip label="All jobsites" selected={jobsiteId === null} onPress={() => setJobsiteId(null)} />
              {jobsites.data.map((site) => (
                <Chip
                  key={site.id}
                  icon="map-pin"
                  label={site.label}
                  accessibilityLabel={`Only orders for ${site.label}`}
                  selected={jobsiteId === site.id}
                  onPress={() => setJobsiteId(jobsiteId === site.id ? null : site.id)}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
      {segment === 'quotes' ? (
        <QuotesList uid={user.uid} />
      ) : (
        <OrdersList key={segment} uid={user.uid} state={segment} jobsiteId={jobsiteId} />
      )}
    </View>
  );
}

function OrdersList({
  uid,
  state,
  jobsiteId,
}: {
  uid: string;
  state: 'active' | 'past';
  jobsiteId: string | null;
}) {
  const orders = useCustomerOrders(uid, state, { jobsiteId });
  const now = useNow(60_000);
  const { reorder, busyId } = useReorder();

  if (orders.loading && orders.items.length === 0) {
    return (
      <View style={[styles.padded, webColumn]}>
        <SkeletonList count={4} circle={42} lines={3} />
      </View>
    );
  }
  if (orders.error && orders.items.length === 0) {
    return (
      <View style={[styles.padded, webColumn]}>
        <ErrorState title="Couldn't load your orders" error={orders.error} onRetry={orders.retry} />
      </View>
    );
  }
  return (
    <FlatList<Order>
      data={orders.items}
      keyExtractor={(order) => order.id}
      renderItem={({ item }) => (
        <OrderListCard
          order={item}
          now={now}
          reordering={busyId === item.id}
          onReorder={(order) => void reorder(order)}
        />
      )}
      contentContainerStyle={[styles.list, webColumn]}
      refreshControl={
        <RefreshControl refreshing={orders.refreshing} onRefresh={orders.retry} tintColor={colors.primary} />
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (orders.hasMore && !orders.loadingMore) orders.loadMore();
      }}
      ListFooterComponent={orders.loadingMore ? <SkeletonList count={1} circle={42} lines={2} /> : undefined}
      ListEmptyComponent={
        state === 'active' ? (
          <EmptyState
            art="scene-jobsite-delivery"
            title={jobsiteId ? 'Nothing on the way to this site' : 'No orders on the way'}
            message="Order studs, drywall, fittings and more from local GTA suppliers. Every store's part is tracked here."
            action={<Button label="Start shopping" onPress={() => router.navigate('/')} />}
          />
        ) : (
          <EmptyState
            art="scene-order-confirmed"
            title={jobsiteId ? 'No past orders for this site' : 'No past orders yet'}
            message="Completed and cancelled orders show up here, ready to reorder in one tap."
          />
        )
      }
    />
  );
}

function QuotesList({ uid }: { uid: string }) {
  const quotes = useCustomerQuotes(uid);
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
      ListHeaderComponent={
        quotes.items.length > 0 ? (
          <Button
            label="Send us your material list"
            icon="plus"
            variant="secondary"
            onPress={() => router.push('/quotes/new')}
          />
        ) : undefined
      }
      ListEmptyComponent={
        <EmptyState
          art="scene-material-list"
          title="Send us your material list"
          message="Type it, paste it, or upload a photo. Expect a quote within 30 minutes during business hours."
          action={<Button label="Send my list" onPress={() => router.push('/quotes/new')} />}
        />
      }
      ListFooterComponent={
        quotes.loadingMore ? (
          <SkeletonList count={1} circle={42} lines={2} />
        ) : quotes.items.length > 0 ? (
          <Text variant="caption" color="muted" align="center">
            Quotes are priced by InstaSupply with our local suppliers.
          </Text>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm, paddingRight: spacing.gutter },
  controls: { gap: spacing.md, paddingBottom: spacing.md, paddingHorizontal: spacing.gutter },
  controlsBar: { backgroundColor: colors.surface },
  fill: { backgroundColor: colors.background, flex: 1 },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
  },
  padded: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
});
