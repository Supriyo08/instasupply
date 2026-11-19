import { isValidEmail } from '@instasupply/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { signIn } from '@/features/auth/auth-service';
import { describeError } from '@/lib/errors';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <AuthHeader title="Welcome back" subtitle="Sign in to see today's deliveries." />
      {error ? <Banner tone="danger" message={error} /> : null}
      <View style={styles.form}>
        <Input
          label="Email"
          icon="mail-outline"
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
        />
        <Input
          label="Password"
          icon="lock-closed-outline"
          placeholder="Your password"
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <Link href="/forgot-password" style={styles.link}>
          <Text variant="caption" color="primary">
            Forgot password?
          </Text>
        </Link>
      </View>
      <Button label="Sign in" size="lg" loading={busy} onPress={submit} />
      <View style={styles.footer}>
        <Text color="muted">New to InstaSupply?</Text>
        <Link href="/sign-up">
          <Text variant="bodyStrong" color="primary">
            Create a driver account
          </Text>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center', gap: 4, marginTop: 8 },
  form: { gap: 14 },
  link: { alignSelf: 'flex-end' },
});
