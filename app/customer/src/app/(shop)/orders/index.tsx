import { isOrderOpen, type Order } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, Header, Screen, Text } from '@/components/ui';
import { OrderCard } from '@/features/orders/components/OrderCard';
import { SkeletonList } from '@/features/orders/components/Skeletons';
import { useOrders } from '@/features/orders/hooks';
import { useCustomer } from '@/features/session/SessionProvider';
import { colors, radius, spacing } from '@/theme/tokens';

interface OrderSection {
  title: string;
  data: Order[];
}

/** "My Orders": live list split into orders in progress and past orders. */
export default function OrdersScreen() {
  return (
    <Screen header={<Header title="My Orders" />} scroll={false} contentStyle={styles.body}>
      <OrdersList />
    </Screen>
  );
}

function OrdersList() {
  const { user } = useCustomer();
  const { data, loading, error, retry } = useOrders(user.uid);
  const insets = useSafeAreaInsets();

  const sections = useMemo<OrderSection[]>(
    () =>
      [
        { title: 'In progress', data: data.filter((order) => isOrderOpen(order.status)) },
        { title: 'Past orders', data: data.filter((order) => !isOrderOpen(order.status)) },
      ].filter((section) => section.data.length > 0),
    [data],
  );

  if (loading && data.length === 0) {
    return (
      <View style={styles.padded}>
        <SkeletonList count={3} bar />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.padded}>
        <ErrorState title="Couldn't load your orders" error={error} onRetry={retry} />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(order) => order.id}
      renderItem={({ item }) => <OrderCard order={item} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader} accessibilityRole="header">
          <Text variant="heading">{section.title}</Text>
          <View style={styles.count}>
            <Text variant="micro" color="muted">
              {section.data.length}
            </Text>
          </View>
        </View>
      )}
      ItemSeparatorComponent={Gap}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxxl }]}
      ListEmptyComponent={
        <EmptyState
          art="scene-local-suppliers"
          title="No orders yet"
          message="Fresh fruit, veggies and daily essentials are a few taps away. Your orders will show up here."
          action={
            <Button
              label="Start shopping"
              trailingIcon="shopping-bag"
              onPress={() => router.dismissTo('/')}
            />
          }
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
  count: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  gap: { height: spacing.md },
  list: { flexGrow: 1, paddingHorizontal: spacing.gutter, paddingTop: spacing.xs },
  padded: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.lg,
  },
});
