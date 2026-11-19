import { isValidEmail } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Input, Screen } from '@/components/ui';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { resetPassword } from '@/features/auth/auth-service';
import { describeError } from '@/lib/errors';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <AuthHeader title="Reset password" subtitle="We'll email you a link to choose a new password." />
      {sent ? (
        <Banner
          tone="success"
          title="Check your inbox"
          message={`If ${email} has an account, a reset link is on its way.`}
        />
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
      <Input
        label="Email"
        icon="mail-outline"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Button label={sent ? 'Send again' : 'Send reset link'} size="lg" loading={busy} onPress={submit} />
      <Button label="Back to sign in" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
