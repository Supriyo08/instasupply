import { describeError } from '@instasupply/expo-firebase';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { resetPassword } from '@/features/session/auth-service';
import { confirmAction, notify } from '@/lib/notify';
import { colors, radius } from '@/theme/tokens';

/** "Change password" block: confirm, then email a reset link to the account address. */
export function PasswordResetCard({ email }: { email: string | null }) {
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!email) return;
    const confirmed = await confirmAction(
      'Change your password?',
      `We'll email a secure link to ${email}. Open it to choose a new password.`,
      'Send link',
    );
    if (!confirmed) return;
    setSending(true);
    try {
      await resetPassword(email);
      notify('Check your inbox', `We sent a password reset link to ${email}.`);
    } catch (error) {
      notify("Couldn't send the link", describeError(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon name="key" size={20} color={colors.primary} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyMedium">Reset by email</Text>
          <Text variant="caption" color="muted">
            {email
              ? `We'll send a secure link to ${email} so you can choose a new password.`
              : 'Your account has no email address, so the password cannot be reset here.'}
          </Text>
        </View>
      </View>
      <Button
        variant="secondary"
        size="md"
        icon="send"
        label="Send reset link"
        loading={sending}
        disabled={!email}
        onPress={() => void send()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, gap: 14, padding: 16 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  text: { flex: 1, gap: 2 },
});
