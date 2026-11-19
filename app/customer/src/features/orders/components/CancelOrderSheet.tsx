import { describeError } from '@instasupply/expo-firebase';
import { formatCurrency, type Order } from '@instasupply/shared';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Input, Sheet, Text } from '@/components/ui';
import { cancelOrder } from '@/features/orders/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

import { orderTitle } from './order-ui';

const REASONS = [
  'I ordered by mistake',
  'I want to change the items',
  'Delivery is taking too long',
  'I found a better price',
  'Other',
] as const;
type Reason = (typeof REASONS)[number];

/** Bottom sheet asking why, then calling cancelOrder. The server re-checks that it can still be cancelled. */
export function CancelOrderSheet({
  order,
  visible,
  onClose,
  onCancelled,
}: {
  order: Order;
  visible: boolean;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails('');
    setError(null);
  }, [visible]);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await cancelOrder({
        orderId: order.id,
        reason: reason === 'Other' ? details.trim() || 'Other' : reason,
      });
      onCancelled();
    } catch (cause) {
      setError(describeError(cause, "We couldn't cancel your order. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose} title="Cancel this order?">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text color="muted">
          {orderTitle(order)} · {formatCurrency(order.total)}. Tell us why you're cancelling — it helps us
          improve.
        </Text>
        <View accessibilityRole="radiogroup" style={styles.options}>
          {REASONS.map((option) => {
            const selected = reason === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: busy }}
                accessibilityLabel={option}
                disabled={busy}
                onPress={() => setReason(option)}
                style={[styles.option, selected ? styles.optionSelected : null]}
              >
                <View style={[styles.radio, selected ? styles.radioOn : null]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <Text variant="bodyMedium">{option}</Text>
              </Pressable>
            );
          })}
        </View>
        {reason === 'Other' ? (
          <Input
            multiline
            tone="muted"
            accessibilityLabel="Tell us more"
            placeholder="Tell us more (optional)"
            value={details}
            onChangeText={setDetails}
            maxLength={200}
            editable={!busy}
            style={styles.details}
          />
        ) : null}
        {order.paymentStatus === 'paid' ? (
          <Text variant="caption" color="muted">
            Your card payment will be refunded once the order is cancelled.
          </Text>
        ) : null}
        {error ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            label="Cancel order"
            variant="danger"
            loading={busy}
            disabled={!reason}
            onPress={() => void submit()}
          />
          <Button label="Keep my order" variant="ghost" size="md" disabled={busy} onPress={onClose} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.xs },
  content: { gap: spacing.lg, paddingBottom: spacing.xs },
  details: { minHeight: 76 },
  option: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primaryLight },
  options: { gap: spacing.sm },
  radio: {
    alignItems: 'center',
    borderColor: colors.textSubtle,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  radioDot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, width: 10 },
  radioOn: { borderColor: colors.primary },
  scroll: { flexGrow: 0 },
});
