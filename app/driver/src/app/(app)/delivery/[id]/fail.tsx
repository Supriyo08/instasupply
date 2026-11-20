import { FAILURE_REASONS, type FailureReasonId } from '@instasupply/shared';
import { useConfig } from '@instasupply/api-client/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, Icon, Input, Screen, Skeleton, Text } from '@/components/ui';
import { failDelivery } from '@/features/deliveries/actions';
import { useDelivery } from '@/features/deliveries/hooks';
import { usePresence } from '@/features/location/PresenceProvider';
import { describeError } from '@/lib/api';
import { callPhone } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

/** A driver reports a failed drop-off only once the load is on the vehicle (MARKETPLACE §2.3, §10). */
const REPORTABLE = new Set(['picked_up', 'in_transit', 'arrived']);

/**
 * Report a problem at the site (MARKETPLACE §10 `delivery/[id]/fail`, §2.3 `FAILURE_REASONS`, §3.10;
 * CLIENTS §4.6): `updateDeliveryStatus({ status: 'failed', failureReason, note, location })`.
 */
export default function FailDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const delivery = useDelivery(id);
  const config = useConfig();
  const { colors, radius } = useTheme();
  const { currentPosition } = usePresence();
  const [reason, setReason] = useState<FailureReasonId | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (delivery.loading) {
    return (
      <Screen edges={[]}>
        <Skeleton height={40} />
        <Skeleton height={300} radius={16} />
      </Screen>
    );
  }
  if (delivery.error) {
    return (
      <Screen edges={[]}>
        <ErrorState error={delivery.error} onRetry={delivery.retry} title="Couldn't load this delivery" />
      </Screen>
    );
  }
  const data = delivery.data;
  if (!data || !REPORTABLE.has(data.status)) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Nothing to report here"
          message={
            data?.status === 'failed'
              ? 'This delivery is already reported. Dispatch will tell you what to do with the load.'
              : 'You can report a problem once the load is on your vehicle. Before that, release the job instead.'
          }
          action={<Button label="Back" fullWidth={false} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const selected = FAILURE_REASONS.find((option) => option.id === reason) ?? null;
  const supportPhone = config?.supportPhone ?? null;

  const submit = async () => {
    if (!reason) {
      setError('Choose what went wrong.');
      return;
    }
    if (reason === 'other' && !note.trim()) {
      setError('Add a short note so dispatch can help.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const position = await currentPosition();
      await failDelivery(
        data.id,
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
          onPress={() => void submit()}
        />
      }
    >
      <Text color="muted">
        Dispatch is told right away and decides whether to re-attempt {data.orderId} or return it to the
        store. Keep the load on your vehicle until they call.
      </Text>
      {supportPhone ? (
        <Button
          label="Call dispatch first"
          icon="call-outline"
          variant="secondary"
          onPress={() => void callPhone(supportPhone)}
        />
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="What went wrong">
        {FAILURE_REASONS.map((option) => {
          const isSelected = option.id === reason;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                setReason(option.id);
                setError(null);
              }}
              style={[
                styles.option,
                {
                  borderRadius: radius.md,
                  borderColor: isSelected ? colors.danger : colors.border,
                  backgroundColor: isSelected ? colors.dangerSoft : colors.surface,
                },
              ]}
            >
              <Icon
                name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={isSelected ? colors.danger : colors.textSubtle}
              />
              <Text style={styles.flex}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {selected ? (
        <Banner
          tone={selected.siteCaused ? 'info' : 'warning'}
          message={
            selected.siteCaused
              ? 'The site caused this, so you are still paid for the trip.'
              : 'This reason is not paid. Ops reviews it with your note.'
          }
        />
      ) : null}
      <Input
        label={reason === 'other' ? 'Details (required)' : 'Details'}
        placeholder="e.g. Called the site contact twice, gate locked"
        value={note}
        onChangeText={setNote}
        multiline
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  option: { alignItems: 'center', borderWidth: 1.5, flexDirection: 'row', gap: 10, padding: 14 },
  options: { gap: 8 },
});
