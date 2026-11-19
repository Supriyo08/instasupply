import { formatDateTime } from '@instasupply/shared';
import { Link, useParams } from 'react-router';

import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { OrdersIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useDelivery } from '@/features/deliveries/hooks';

import { CustomerCard } from './components/CustomerCard';
import { FulfilmentCard } from './components/FulfilmentCard';
import { OrderActions } from './components/OrderActions';
import { OrderStatusBadge } from './components/OrderBadges';
import { OrderItemsCard } from './components/OrderItemsCard';
import { PackingSlip } from './components/PackingSlip';
import { PaymentCard } from './components/PaymentCard';
import { useOrder } from './hooks';

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const order = useOrder(orderId);
  const delivery = useDelivery(order.data?.deliveryId);

  if (order.loading && !order.data) return <PageSpinner label="Loading order" />;
  if (order.error) return <ErrorState error={order.error} />;
  if (!order.data) {
    return (
      <EmptyState
        icon={OrdersIcon}
        title="Order not found"
        description="It may have been removed, or the link is incomplete."
        action={
          <Link to="/orders" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Back to orders
          </Link>
        }
      />
    );
  }

  const record = order.data;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          back={{ to: '/orders', label: 'Orders' }}
          title={
            <span className="flex flex-wrap items-center gap-3">
              <span className="font-mono">{record.number}</span>
              <OrderStatusBadge status={record.status} />
            </span>
          }
          description={`Placed ${formatDateTime(record.createdAt)} by ${record.customerName}`}
          actions={<OrderActions order={record} delivery={delivery.data} />}
        />

        {/* Wide screens: items and fulfilment left, customer and payment right. */}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            <OrderItemsCard order={record} />
            <FulfilmentCard order={record} delivery={delivery} />
          </div>
          <div className="space-y-6">
            <CustomerCard order={record} />
            <PaymentCard order={record} />
          </div>
        </div>
      </div>

      <PackingSlip order={record} driverName={delivery.data?.driverName ?? null} />
    </>
  );
}
