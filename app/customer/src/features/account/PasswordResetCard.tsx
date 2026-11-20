import { describeError } from '@instasupply/api-client';
import { isStrongPassword } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Input, Notice, Text } from '@/components/ui';
import { changePassword } from '@/features/session/auth-service';
import { colors, radius, spacing } from '@/theme/tokens';

/** "Change password": the current and a new password (`api.session.changePassword`). */
export function PasswordResetCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const strength = next ? isStrongPassword(next) : { ok: false };

  const save = async () => {
    setError(null);
    setDone(false);
    if (!strength.ok) {
      setError(strength.message ?? 'Choose a stronger password.');
      return;
    }
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon name="key" size={20} color={colors.primary} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyMedium">Change password</Text>
          <Text variant="caption" color="muted">
            Use at least 8 characters with letters and a number.
          </Text>
        </View>
      </View>
      <Input
        tone="muted"
        icon="lock"
        placeholder="Current password"
        secureTextEntry
        autoComplete="current-password"
        value={current}
        onChangeText={setCurrent}
      />
      <Input
        tone="muted"
        icon="lock"
        placeholder="New password"
        secureTextEntry
        autoComplete="new-password"
        value={next}
        onChangeText={setNext}
      />
      {error ? <Notice tone="danger" message={error} /> : null}
      {done ? <Notice tone="success" message="Password changed." /> : null}
      <Button
        variant="secondary"
        size="md"
        icon="check"
        label="Change password"
        loading={busy}
        disabled={!current || !next}
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: 2 },
});
