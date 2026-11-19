import { canCustomerCancel, pluralize, type Order } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button, EmptyState, ErrorState, Header, Screen } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { useToast } from '@/features/notifications/ToastProvider';
import { CancelOrderSheet } from '@/features/orders/components/CancelOrderSheet';
import { DeliveryAddressCard } from '@/features/orders/components/DeliveryAddressCard';
import { LiveTracking } from '@/features/orders/components/LiveTracking';
import { orderTitle } from '@/features/orders/components/order-ui';
import { OrderItemsCard } from '@/features/orders/components/OrderItemsCard';
import { OrderPaymentCard } from '@/features/orders/components/OrderPaymentCard';
import { OrderSummaryCard } from '@/features/orders/components/OrderSummaryCard';
import { OrderTimeline } from '@/features/orders/components/OrderTimeline';
import { RateItemsCard } from '@/features/orders/components/RateItemsCard';
import { OrderDetailSkeleton } from '@/features/orders/components/Skeletons';
import { SupportCard } from '@/features/orders/components/SupportCard';
import { useOrder } from '@/features/orders/hooks';

const header = <Header title="Track Order" />;

/** "Track Order": live status, map + hand-off code while out for delivery, timeline, items and totals. */
export default function TrackOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderDetail key={id} id={id} />;
}

function OrderDetail({ id }: { id: string | undefined }) {
  const { data: order, loading, error, retry } = useOrder(id);

  if (loading && !order) {
    return (
      <Screen header={header}>
        <OrderDetailSkeleton />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen header={header}>
        <ErrorState title="Couldn't load this order" error={error} onRetry={retry} />
      </Screen>
    );
  }
  if (!order) {
    return (
      <Screen header={header}>
        <EmptyState
          art="scene-local-suppliers"
          title="Order not found"
          message="This order doesn't exist or belongs to another account."
          action={<Button label="View my orders" onPress={() => router.replace('/orders')} />}
        />
      </Screen>
    );
  }
  return <OrderContent order={order} />;
}

function OrderContent({ order }: { order: Order }) {
  const cart = useCart();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const closed = order.status === 'delivered' || order.status === 'cancelled';
  const live = order.status === 'packed' || order.status === 'out_for_delivery';

  const orderAgain = () => {
    order.items.forEach((item) => cart.add(item.productId, item.quantity));
    toast({
      title: 'Added to your cart',
      body: `${pluralize(order.itemCount, 'item')} from ${orderTitle(order)}`,
      icon: 'shopping-bag',
    });
    router.push('/cart');
  };

  return (
    <>
      <Screen
        header={header}
        footer={
          closed ? <Button label="Order again" trailingIcon="shopping-bag" onPress={orderAgain} /> : undefined
        }
      >
        <OrderSummaryCard order={order} />
        {live ? <LiveTracking order={order} /> : null}
        <OrderTimeline order={order} />
        {order.status === 'delivered' ? <RateItemsCard items={order.items} /> : null}
        <OrderItemsCard items={order.items} itemCount={order.itemCount} />
        <OrderPaymentCard order={order} />
        <DeliveryAddressCard address={order.address} notes={order.notes} />
        <SupportCard orderNumber={order.number} />
        {canCustomerCancel(order.status) ? (
          <Button label="Cancel order" variant="danger" icon="x-circle" onPress={() => setCancelling(true)} />
        ) : null}
      </Screen>
      {/* Stays mounted while open even if the status moves on; the server then explains why it can't cancel. */}
      <CancelOrderSheet
        order={order}
        visible={cancelling}
        onClose={() => setCancelling(false)}
        onCancelled={() => {
          setCancelling(false);
          toast({
            title: 'Order cancelled',
            body: `${orderTitle(order)} has been cancelled.`,
            icon: 'x-circle',
          });
        }}
      />
    </>
  );
}
