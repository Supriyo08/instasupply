import { useConfig } from '@instasupply/api-client/react';
import { orderHeadline, type Issue, type StoreOrder } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Icon,
  IconButton,
  Screen,
  StatusPill,
  Text,
} from '@/components/ui';
import { useCustomerIssues } from '@/features/issues/hooks';
import { CancelSheet } from '@/features/orders/components/CancelSheet';
import { OrderReceipt } from '@/features/orders/components/OrderReceipt';
import { OrderDetailSkeleton } from '@/features/orders/components/Skeletons';
import { StoreOrderCard } from '@/features/orders/components/StoreOrderCard';
import { useOrder, useOrderStoreOrders } from '@/features/orders/hooks';
import { isCancellable, orderTone, placedAtText } from '@/features/orders/order-format';
import { firstParam } from '@/features/orders/params';
import { useReorder } from '@/features/orders/reorder';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useCustomer } from '@/features/session/SessionProvider';
import { supportHref } from '@/features/support/links';
import { useNow } from '@/hooks/useNow';
import { colors, spacing } from '@/theme/tokens';

/** Order detail 🔒 (MARKETPLACE §7.3 orders/[id]; CLIENTS §4.3). */
export default function OrderScreen() {
  return (
    <RequireAccount title="Order">
      <OrderBody />
    </RequireAccount>
  );
}

function OrderBody() {
  const { user } = useCustomer();
  const orderId = firstParam(useLocalSearchParams<{ id: string }>().id);
  const order = useOrder(orderId);
  const storeOrders = useOrderStoreOrders(orderId);
  const issues = useCustomerIssues(user.uid);
  const config = useConfig();
  const now = useNow(30_000);
  const { reorder, busyId } = useReorder();
  const [cancelling, setCancelling] = useState<{ storeOrders: StoreOrder[]; whole: boolean }>({
    storeOrders: [],
    whole: false,
  });

  const openIssueFor = useMemo(() => {
    const byStoreOrder = new Map<string, Issue>();
    for (const issue of issues.items) {
      if (issue.orderId !== orderId) continue;
      const known = byStoreOrder.get(issue.storeOrderId);
      // An open case wins over a resolved one; otherwise the newest.
      if (!known || (known.status === 'resolved' && issue.status !== 'resolved')) {
        byStoreOrder.set(issue.storeOrderId, issue);
      }
    }
    return byStoreOrder;
  }, [issues.items, orderId]);

  const data = order.data;
  const title = data?.number ?? 'Order';
  const header = (
    <Header
      title={title}
      right={
        data ? (
          <IconButton
            icon="message-circle"
            label={`Contact support about ${data.number}`}
            onPress={() =>
              router.push(supportHref({ kind: 'order', id: data.id, label: `About ${data.number}` }))
            }
          />
        ) : undefined
      }
    />
  );

  if ((order.loading && !data) || (storeOrders.loading && storeOrders.data.length === 0 && data)) {
    return (
      <Screen header={header}>
        <OrderDetailSkeleton />
      </Screen>
    );
  }
  if (order.error && !data) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load this order" error={order.error} onRetry={order.retry} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-empty-cart"
          title="Order not found"
          message="It may belong to another account. Your orders are on the Orders tab."
          action={<Button label="See my orders" onPress={() => router.navigate('/orders')} />}
        />
      </Screen>
    );
  }

  const cancellable = storeOrders.data.filter((storeOrder) => isCancellable(storeOrder.status));
  const reorderable = data.source !== 'replacement';
  const site = data.jobsite;

  return (
    <Screen
      header={header}
      refreshing={order.refreshing}
      onRefresh={() => {
        order.retry();
        storeOrders.retry();
      }}
    >
      <Card style={styles.summary}>
        <StatusPill label={orderHeadline(data)} tone={orderTone(data.status)} />
        <Text variant="caption" color="muted">
          Placed {placedAtText(data, now)}
          {data.source === 'quote'
            ? ' · from your quote'
            : data.source === 'replacement'
              ? ' · replacement'
              : ''}
        </Text>
        {data.fulfilment === 'delivery' && site ? (
          <View style={styles.siteRow} accessible>
            <Icon name="map-pin" size={18} color={colors.primaryDark} />
            <View style={styles.flex}>
              <Text variant="bodyMedium">{site.label}</Text>
              <Text variant="caption" color="muted">
                {site.addressLine}
              </Text>
              {data.window ? (
                <Text variant="captionMedium" color="primaryDark">
                  {data.window.kind === 'asap' ? 'ASAP · ' : ''}
                  {data.window.label}
                </Text>
              ) : null}
              {data.siteContact ? (
                <Text variant="caption" color="muted">
                  Site contact: {data.siteContact.name}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.siteRow}>
            <Icon name="shopping-bag" size={18} color={colors.primaryDark} />
            <Text variant="bodyMedium" style={styles.flex}>
              Pickup at {data.storeCount === 1 ? 'the store' : `${data.storeCount} stores`}
            </Text>
          </View>
        )}
      </Card>

      {storeOrders.error && storeOrders.data.length === 0 ? (
        <ErrorState title="Couldn't load the stores" error={storeOrders.error} onRetry={storeOrders.retry} />
      ) : (
        storeOrders.data.map((storeOrder) => (
          <StoreOrderCard
            key={storeOrder.id}
            storeOrder={storeOrder}
            summary={data.storeOrders.find((summary) => summary.storeOrderId === storeOrder.id) ?? null}
            openIssue={openIssueFor.get(storeOrder.id) ?? null}
            now={now}
            cancelling={false}
            onCancel={(pending) => setCancelling({ storeOrders: [pending], whole: false })}
          />
        ))
      )}

      <OrderReceipt order={data} hstNumber={data.hstNumber ?? config?.hstNumber ?? null} />

      {reorderable ? (
        <View style={styles.actions}>
          <Button
            label="Reorder"
            icon="repeat"
            variant="secondary"
            loading={busyId === data.id}
            onPress={() => void reorder(data, { storeOrders: storeOrders.data })}
          />
          {data.fulfilment === 'delivery' ? (
            <Button
              label="Reorder & checkout"
              icon="zap"
              disabled={busyId === data.id}
              onPress={() => void reorder(data, { storeOrders: storeOrders.data, checkout: true })}
            />
          ) : null}
        </View>
      ) : null}
      {cancellable.length > 0 ? (
        <Button
          label="Cancel order"
          variant="danger"
          onPress={() => setCancelling({ storeOrders: cancellable, whole: true })}
        />
      ) : null}

      <CancelSheet
        orderId={data.id}
        orderNumber={data.number}
        storeOrders={cancelling.storeOrders}
        whole={cancelling.whole}
        onClose={() => setCancelling({ storeOrders: [], whole: false })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  flex: { flex: 1, gap: 1 },
  siteRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  summary: { gap: spacing.sm + 2 },
});
