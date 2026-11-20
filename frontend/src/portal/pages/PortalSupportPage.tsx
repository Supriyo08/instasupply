import { useLiveQuery } from '@instasupply/api-client/react';
import type { SupportContext } from '@instasupply/shared';
import { useSearchParams } from 'react-router';

import { PageHeader } from '@/components/ui/Layout';
import { useSupplier } from '@/features/auth/AuthProvider';
import { queries } from '@/lib/api';

import { SupportChat } from '../components/SupportChat';

/**
 * `/portal/support` (MARKETPLACE §8, CLIENTS §4.4): the store's chat with InstaSupply. Opened from an
 * order with `?about={storeOrderId}`, the first message carries that order as its context chip.
 */
export default function PortalSupportPage() {
  const { storeId, user, displayName } = useSupplier();
  const [params, setParams] = useSearchParams();
  const about = params.get('about');
  const order = useLiveQuery(queries.storeOrder(about)).data;
  const context: SupportContext | null =
    order && order.storeId === storeId ? { kind: 'store_order', id: order.id, label: order.number } : null;

  return (
    <>
      <PageHeader
        title="Support"
        description="Chat with the InstaSupply ops team. Everyone on your store's team sees this conversation."
      />
      <SupportChat
        storeId={storeId}
        sender={{ uid: user.uid, name: displayName }}
        context={context}
        onClearContext={() => {
          if (!about) return;
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.delete('about');
              return next;
            },
            { replace: true },
          );
        }}
      />
    </>
  );
}
