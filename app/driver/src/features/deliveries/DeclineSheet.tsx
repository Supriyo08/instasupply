import { DECLINE_REASONS, type DeclineReasonId } from '@instasupply/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Icon, Input, Sheet, Text } from '@/components/ui';
import { describeError } from '@/lib/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { declineDelivery } from './actions';
import { notify } from './useDeliveryAction';

export function DeclineSheet({
  deliveryId,
  onClose,
  onDeclined,
}: {
  deliveryId: string | null;
  onClose: () => void;
  onDeclined?: () => void;
}) {
  const { colors, radius } = useTheme();
  const [reason, setReason] = useState<DeclineReasonId | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason(null);
    setNote('');
    onClose();
  };

  const submit = async () => {
    if (!deliveryId || !reason) return;
    setBusy(true);
    try {
      await declineDelivery(deliveryId, reason, note.trim() || null);
      close();
      onDeclined?.();
    } catch (error) {
      notify("Couldn't decline", describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={!!deliveryId} onClose={close} title="Decline delivery">
      <Text color="muted">Dispatch will reassign it to another driver. Why are you declining?</Text>
      <View style={styles.options}>
        {DECLINE_REASONS.map((option) => {
          const selected = option.id === reason;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setReason(option.id)}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primarySoft : colors.surface,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Icon
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? colors.primary : colors.textSubtle}
              />
              <Text>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {reason === 'other' ? (
        <Input placeholder="Add a short note" value={note} onChangeText={setNote} />
      ) : null}
      <Button label="Decline delivery" variant="danger" disabled={!reason} loading={busy} onPress={submit} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  option: { alignItems: 'center', borderWidth: 1.5, flexDirection: 'row', gap: 10, padding: 12 },
  options: { gap: 8 },
});
