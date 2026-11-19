import { formatCurrency } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Button, Skeleton, Text } from '@/components/ui';

/** Pinned bottom of the payment step: amount to pay and the gradient "Place order" button. */
export function PlaceOrderFooter({
  total,
  loading,
  placing,
  disabled,
  hint,
  onPlace,
}: {
  total: number;
  loading: boolean;
  placing: boolean;
  disabled: boolean;
  /** What the shopper still has to do before ordering (e.g. pick a card). */
  hint: string | null;
  onPlace: () => void;
}) {
  return (
    <View style={styles.footer}>
      <View style={styles.totalRow}>
        <Text variant="body" color="muted">
          Total to pay
        </Text>
        {loading ? (
          <Skeleton style={styles.amount} />
        ) : (
          <Text variant="title" accessibilityLabel={`Total to pay ${formatCurrency(total)}`}>
            {formatCurrency(total)}
          </Text>
        )}
      </View>
      {hint ? (
        <Text variant="caption" color="muted" align="center" accessibilityLiveRegion="polite">
          {hint}
        </Text>
      ) : null}
      <Button label="Place order" loading={placing} disabled={disabled} onPress={onPlace} />
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { height: 22, width: 90 },
  footer: { gap: 10 },
  totalRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
