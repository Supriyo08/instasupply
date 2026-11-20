import { isValidEmail } from '@instasupply/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { signIn } from '@/features/auth/auth-service';
import { endReasonMessage, useSession } from '@/features/auth/SessionProvider';

/**
 * Sign-in (CLIENTS §2.3, §2.4). It says why the last session ended (expired, revoked, replaced). A
 * suspended account never lands here: the session shows the account screen instead.
 */
export default function SignInScreen() {
  const { endReason } = useSession();
  const ended = endReasonMessage(endReason);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: { email?: string; password?: string } = {};
    if (!isValidEmail(email)) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // The session moves on by itself: onboarding, pending approval or the Jobs board.
    } catch (cause) {
      setError(authErrorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <SceneArt scene="scene-welcome" height={170} />
      <AuthHeader
        title="Welcome back"
        subtitle="Sign in to pick up jobs from building suppliers across the GTA."
      />
      {error ? <Banner tone="danger" message={error} /> : null}
      {!error && ended ? <Banner tone="warning" message={ended} /> : null}
      <View style={styles.form}>
        <Input
          label="Email"
          icon="mail-outline"
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
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
          onSubmitEditing={() => void submit()}
          returnKeyType="go"
          error={errors.password}
        />
        <Link href="/forgot-password" style={styles.link} accessibilityRole="link">
          <Text variant="caption" color="primary">
            Forgot password?
          </Text>
        </Link>
      </View>
      <Button label="Sign in" size="lg" loading={busy} onPress={() => void submit()} />
      <View style={styles.footer}>
        <Text color="muted">New to InstaSupply?</Text>
        <Link href="/sign-up" accessibilityRole="link">
          <Text variant="bodyStrong" color="primary">
            Drive with us: create an account
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
