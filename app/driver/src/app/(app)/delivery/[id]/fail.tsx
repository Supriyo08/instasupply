import { FAILURE_REASONS, type FailureReasonId } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner, Button, Icon, Input, Screen, Text } from '@/components/ui';
import { failDelivery } from '@/features/deliveries/actions';
import { useDelivery } from '@/features/deliveries/hooks';
import { usePresence } from '@/features/location/PresenceProvider';
import { describeError } from '@/lib/errors';
import { useTheme } from '@/theme/ThemeProvider';

export default function FailDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: delivery } = useDelivery(id);
  const { colors, radius } = useTheme();
  const { currentPosition } = usePresence();
  const [reason, setReason] = useState<FailureReasonId | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!delivery) return <Screen edges={[]}>{null}</Screen>;

  const submit = async () => {
    if (!reason) return setError('Choose what went wrong.');
    if (reason === 'other' && !note.trim()) return setError('Add a short note so dispatch can help.');
    setBusy(true);
    setError(null);
    try {
      const position = await currentPosition();
      await failDelivery(
        delivery.id,
        reason,
        note.trim() || null,
        position ? { lat: position.lat, lng: position.lng } : null,
      );
      router.dismissTo('/');
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Screen
      edges={[]}
      keyboard
      footer={
        <Button
          label="Mark as failed"
          size="lg"
          variant="danger"
          disabled={!reason}
          loading={busy}
          onPress={submit}
        />
      }
    >
      <Text color="muted">
        Dispatch is notified right away and can reschedule or reassign {delivery.orderId}. Keep the package
        with you.
      </Text>
      {error ? <Banner tone="danger" message={error} /> : null}
      <View style={styles.options}>
        {FAILURE_REASONS.map((option) => {
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
                  borderRadius: radius.md,
                  borderColor: selected ? colors.danger : colors.border,
                  backgroundColor: selected ? colors.dangerSoft : colors.surface,
                },
              ]}
            >
              <Icon
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? colors.danger : colors.textSubtle}
              />
              <Text>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label="Details"
        placeholder="e.g. Called twice, gate locked"
        value={note}
        onChangeText={setNote}
        multiline
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { alignItems: 'center', borderWidth: 1.5, flexDirection: 'row', gap: 10, padding: 14 },
  options: { gap: 8 },
});
