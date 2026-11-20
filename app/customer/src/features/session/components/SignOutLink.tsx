import { describeError } from '@instasupply/api-client';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { signOut } from '@/features/session/auth-service';
import { confirmAction, notify } from '@/lib/notify';
import { colors, spacing } from '@/theme/tokens';

import { forgetCodeRequest } from './phone';

/** "Signed in as … · Use a different account" escape hatch for the setup steps. */
export function SignOutLink({ email }: { email?: string | null }) {
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    const confirmed = await confirmAction(
      'Use a different account?',
      'You will be signed out. Your progress on this account is saved.',
      'Sign out',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      forgetCodeRequest();
      await signOut();
    } catch (error) {
      notify('Could not sign out', describeError(error));
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {email ? (
        <Text variant="caption" color="muted" align="center" numberOfLines={1}>
          Signed in as {email}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use a different account"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        hitSlop={8}
        onPress={() => void leave()}
        style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <Text variant="captionMedium" color="primary">
          Use a different account
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  wrap: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
});
