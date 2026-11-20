/** Pieces of the delivery screen (MARKETPLACE §10 `delivery/[id]`): stepper, PIN card, release sheet. */
import {
  DECLINE_REASONS,
  driverPhaseFor,
  type DeclineReasonId,
  type Delivery,
  type DriverPhase,
} from '@instasupply/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Icon, Input, Sheet, Text } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';

import { declineDelivery } from './actions';

const STEPS: { phase: DriverPhase; label: string }[] = [
  { phase: 'to_store', label: 'To store' },
  { phase: 'at_store', label: 'At store' },
  { phase: 'loaded', label: 'Loaded' },
  { phase: 'to_site', label: 'To site' },
  { phase: 'at_site', label: 'At site' },
  { phase: 'delivered', label: 'Done' },
];

/** To store → At store → Loaded → To site → At site → Done, from `driverPhaseFor`. */
export function DeliveryStepper({ delivery }: { delivery: Delivery }) {
  const { colors } = useTheme();
  const phase = driverPhaseFor(delivery);
  // `assigned` sits before the first step; `problem` and cancelled are told by a banner instead.
  const steps = delivery.pickup ? STEPS : STEPS.filter((step) => step.phase !== 'at_store');
  const currentIndex = phase === 'assigned' ? -1 : steps.findIndex((step) => step.phase === phase);
  const finished = phase === 'delivered';
  const label = phase === 'assigned' ? 'Not started yet' : (steps[currentIndex]?.label ?? 'Stopped');
  return (
    <View style={styles.stepper} accessible accessibilityLabel={`Progress: ${label}`}>
      {steps.map((step, index) => {
        const done = finished || (currentIndex >= 0 && index < currentIndex);
        const active = !finished && index === currentIndex;
        const tint = done || active ? colors.primary : colors.textSubtle;
        return (
          <View key={step.phase} style={styles.step}>
            <View
              style={[
                styles.bar,
                {
                  backgroundColor: done ? colors.primary : active ? colors.primarySoft : colors.surfaceMuted,
                },
                active ? { borderColor: colors.primary, borderWidth: 1 } : null,
              ]}
            />
            <Text variant="micro" numberOfLines={1} style={{ color: tint }}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** "Show this PIN at the counter: 4831". The store types it in; the screen then moves on by itself. */
export function PinCard({ code, ready }: { code: string; ready: boolean }) {
  const { colors, radius } = useTheme();
  return (
    <Card accent={colors.primary}>
      <View
        style={styles.pin}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Show this PIN at the counter: ${code.split('').join(' ')}`}
      >
        <Text variant="bodyStrong" align="center">
          Show this PIN at the counter
        </Text>
        <View style={styles.digits}>
          {code.split('').map((digit, index) => (
            <View
              key={index}
              style={[styles.digit, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]}
            >
              <Text variant="display" color="primary">
                {digit}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption" color="muted" align="center">
          {ready
            ? 'The store enters it to confirm you collected the load. This screen updates as soon as they do.'
            : 'The store is still preparing the order. Keep the PIN ready; they enter it when the load is on your vehicle.'}
        </Text>
      </View>
    </Card>
  );
}

/**
 * Release a claimed job before collection (MARKETPLACE §2.3): back on the board for other drivers, no
 * pay, and the driver cannot claim it again for an hour (`RELEASED_RECENTLY`).
 */
export function ReleaseSheet({
  deliveryId,
  visible,
  onClose,
  onReleased,
}: {
  deliveryId: string;
  visible: boolean;
  onClose: () => void;
  onReleased: () => void;
}) {
  const { colors, radius } = useTheme();
  const [reason, setReason] = useState<DeclineReasonId | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason(null);
    setNote('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!reason) return;
    if (reason === 'other' && !note.trim()) {
      setError('Add a short note so dispatch knows why.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await declineDelivery(deliveryId, reason, note.trim() || null);
      close();
      onReleased();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Release this job">
      <Text color="muted">
        The job goes back on the board for another driver. Releasing pays nothing, and you can't take this job
        again for an hour.
      </Text>
      {error ? <Banner tone="danger" message={error} /> : null}
      <View style={styles.options} accessibilityRole="radiogroup">
        {DECLINE_REASONS.map((option) => {
          const selected = option.id === reason;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => setReason(option.id)}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.danger : colors.border,
                  backgroundColor: selected ? colors.dangerSoft : colors.surface,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Icon
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? colors.danger : colors.textSubtle}
              />
              <Text style={styles.flex}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Input
        label={reason === 'other' ? 'Note (required)' : 'Note (optional)'}
        placeholder="e.g. Truck won't start"
        value={note}
        onChangeText={setNote}
      />
      <Button
        label="Release job"
        variant="danger"
        disabled={!reason}
        loading={busy}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 3, height: 6 },
  digit: { alignItems: 'center', height: 64, justifyContent: 'center', width: 52 },
  digits: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  flex: { flex: 1 },
  option: { alignItems: 'center', borderWidth: 1.5, flexDirection: 'row', gap: 10, padding: 12 },
  options: { gap: 8 },
  pin: { gap: 12 },
  step: { flex: 1, gap: 6 },
  stepper: { flexDirection: 'row', gap: 4 },
});
