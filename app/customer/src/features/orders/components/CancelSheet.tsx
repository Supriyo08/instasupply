import { describeError } from '@instasupply/api-client';
import { formatMoney, pluralize, type StoreOrder } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Notice, Sheet, Text } from '@/components/ui';
import { useToast } from '@/features/notifications/ToastProvider';
import { spacing } from '@/theme/tokens';

import { cancelOrder } from '../hooks';

const REASONS = ['Ordered by mistake', 'Found it elsewhere', 'Not needed on site any more', 'Wrong items'];

/**
 * Confirms cancelling some or all store orders of an order (`cancelOrder`). Only new or accepted ones
 * can go; the answer lists any that moved on meanwhile. The card hold for them is released.
 */
export function CancelSheet({
  orderId,
  orderNumber,
  storeOrders,
  whole,
  onClose,
}: {
  orderId: string;
  orderNumber: string;
  /** The store orders to cancel; empty hides the sheet. */
  storeOrders: readonly StoreOrder[];
  /** True for "Cancel order": every store order that can still be cancelled. */
  whole: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = storeOrders.reduce((sum, storeOrder) => sum + storeOrder.current.totalCents, 0);
  const stores = storeOrders.map((storeOrder) => storeOrder.storeName).join(', ');

  const close = () => {
    if (busy) return;
    setError(null);
    setReason(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await cancelOrder({
        orderId,
        storeOrderIds: whole ? null : storeOrders.map((storeOrder) => storeOrder.id),
        reason,
      });
      if (result.cancelled.length === 0) {
        setError('These items are already being prepared, so they can no longer be cancelled.');
        return;
      }
      const skipped = result.notCancellable.length;
      toast({
        title: whole && skipped === 0 ? `${orderNumber} cancelled` : 'Items cancelled',
        body:
          skipped > 0
            ? `${pluralize(skipped, 'store')} had already started preparing and will go ahead.`
            : "You won't be charged for them. The hold on your card is released.",
        icon: 'x-circle',
      });
      setReason(null);
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={storeOrders.length > 0}
      onClose={close}
      title={whole ? 'Cancel this order?' : 'Cancel these items?'}
    >
      <Text color="muted">
        {whole
          ? `Every store that hasn't started preparing ${orderNumber} will stop: ${stores}.`
          : `${stores} will stop preparing these items.`}{' '}
        You won't be charged the {formatMoney(total)}.
      </Text>
      <View style={styles.reasons} accessibilityLabel="Reason, optional">
        {REASONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={reason === option}
            onPress={() => setReason(reason === option ? null : option)}
          />
        ))}
      </View>
      {error ? <Notice tone="danger" message={error} /> : null}
      <Button
        label={whole ? 'Cancel order' : 'Cancel these items'}
        variant="danger"
        loading={busy}
        onPress={() => void confirm()}
      />
      <Button label="Keep my order" variant="ghost" disabled={busy} onPress={close} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
