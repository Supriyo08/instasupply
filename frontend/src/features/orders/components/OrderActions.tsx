import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { CancelIcon, CopyIcon, PackageIcon, ReceiptIcon, TruckIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { AssignDialog } from '@/features/deliveries/components/AssignDialog';
import { trackingUrl } from '@/features/deliveries/hooks';
import type { DeliveryRecord, OrderRecord } from '@/lib/data';

import { canCancelOrder } from '../order-format';
import { CancelOrderModal } from './CancelOrderModal';

/** Opens the print dialog; while an order page is open, printing shows only its packing slip. */
function printPackingSlip(orderNumber: string) {
  const title = document.title;
  // Browsers suggest the document title as the PDF file name.
  document.title = `Packing slip ${orderNumber}`;
  window.addEventListener(
    'afterprint',
    () => {
      document.title = title;
    },
    { once: true },
  );
  window.print();
}

/** Page-header actions for one order. `delivery` is the live linked delivery (null while loading). */
export function OrderActions({ order, delivery }: { order: OrderRecord; delivery: DeliveryRecord | null }) {
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const copyTrackingLink = async () => {
    const url = trackingUrl(order.trackingToken);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Tracking link copied', 'Share it with the shopper to follow the delivery live.');
    } catch {
      toast.error("Couldn't copy the link", url);
    }
  };

  return (
    <>
      <Link
        to={`/deliveries/${order.deliveryId}`}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium whitespace-nowrap text-slate-700 shadow-sm ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
      >
        <PackageIcon size={16} aria-hidden /> Open delivery
      </Link>
      <Button variant="secondary" icon={CopyIcon} onClick={() => void copyTrackingLink()}>
        Copy tracking link
      </Button>
      <Button variant="secondary" icon={ReceiptIcon} onClick={() => printPackingSlip(order.number)}>
        Print packing slip
      </Button>
      {canCancelOrder(order, delivery) ? (
        <Button variant="secondary" icon={CancelIcon} onClick={() => setCancelling(true)}>
          Cancel order
        </Button>
      ) : null}
      {delivery?.status === 'unassigned' ? (
        <Button icon={TruckIcon} onClick={() => setAssigning(true)}>
          Assign driver
        </Button>
      ) : null}

      <AssignDialog delivery={delivery} open={assigning && !!delivery} onClose={() => setAssigning(false)} />
      <CancelOrderModal
        order={order}
        delivery={delivery}
        open={cancelling}
        onClose={() => setCancelling(false)}
      />
    </>
  );
}
