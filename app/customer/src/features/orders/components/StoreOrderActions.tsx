import { canReportIssue, type Issue, type StoreOrder } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ActionChip } from '@/features/account/ActionChip';
import { supportHref } from '@/features/support/links';
import { spacing } from '@/theme/tokens';

import { isCancellable } from '../order-format';

/**
 * What the customer can do with one store order (MARKETPLACE §7.3 orders/[id]): Track, Cancel these
 * items (new or accepted), Report a problem (within 48 h of completion), Rate store, Contact support.
 */
export function StoreOrderActions({
  storeOrder,
  trackingToken,
  openIssue,
  now,
  onCancel,
  cancelling,
}: {
  storeOrder: StoreOrder;
  trackingToken: string | null;
  openIssue: Issue | null;
  now: number;
  onCancel: (storeOrder: StoreOrder) => void;
  cancelling: boolean;
}) {
  const trackable =
    storeOrder.fulfilment === 'delivery' &&
    trackingToken != null &&
    (storeOrder.status === 'out_for_delivery' ||
      storeOrder.status === 'ready' ||
      storeOrder.driver != null) &&
    storeOrder.status !== 'delivered' &&
    storeOrder.status !== 'cancelled' &&
    storeOrder.status !== 'rejected';
  const completed = storeOrder.status === 'delivered' || storeOrder.status === 'picked_up';
  const reportable = !openIssue && canReportIssue(storeOrder, now);
  return (
    <View style={styles.row}>
      {trackable ? (
        <ActionChip
          icon="navigation"
          label="Track"
          onPress={() => router.push(`/orders/${storeOrder.orderId}/track/${storeOrder.id}`)}
        />
      ) : null}
      {isCancellable(storeOrder.status) ? (
        <ActionChip
          icon="x-circle"
          label="Cancel these items"
          danger
          busy={cancelling}
          onPress={() => onCancel(storeOrder)}
        />
      ) : null}
      {openIssue ? (
        <ActionChip
          icon="alert-circle"
          label={`View ${openIssue.number}`}
          onPress={() => router.push(`/issues/${openIssue.id}`)}
        />
      ) : reportable ? (
        <ActionChip
          icon="alert-triangle"
          label="Report a problem"
          onPress={() => router.push({ pathname: '/issues/new', params: { storeOrderId: storeOrder.id } })}
        />
      ) : null}
      {completed && !storeOrder.rated ? (
        <ActionChip
          icon="star"
          label="Rate store"
          onPress={() =>
            router.push({
              pathname: '/store/[id]/review',
              params: { id: storeOrder.storeId, storeOrderId: storeOrder.id },
            })
          }
        />
      ) : null}
      <ActionChip
        icon="message-circle"
        label="Contact support"
        onPress={() =>
          router.push(
            supportHref({ kind: 'store_order', id: storeOrder.id, label: `About ${storeOrder.number}` }),
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
