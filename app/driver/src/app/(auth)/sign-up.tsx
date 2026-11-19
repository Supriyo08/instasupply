import { isStrongPassword, isValidEmail } from '@instasupply/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { createAccount } from '@/features/auth/auth-service';
import { describeError } from '@/lib/errors';

/** Step 1 of onboarding. Vehicle details, phone verification and approval follow. */
export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (!isValidEmail(email)) next.email = 'Enter a valid email address.';
    const strength = isStrongPassword(password);
    if (!strength.ok) next.password = strength.message!;
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFormError(null);
    try {
      await createAccount(name, email, password);
      // The session now moves on to onboarding (vehicle details).
    } catch (cause) {
      setFormError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <AuthHeader
        title="Drive with InstaSupply"
        subtitle="Create your account. It takes about two minutes."
      />
      {formError ? <Banner tone="danger" message={formError} /> : null}
      <View style={styles.form}>
        <Input
          label="Full name"
          icon="person-outline"
          placeholder="Ravi Kumar"
          autoComplete="name"
          value={name}
          onChangeText={setName}
          error={errors.name}
        />
        <Input
          label="Email"
          icon="mail-outline"
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
        />
        <Input
          label="Password"
          icon="lock-closed-outline"
          placeholder="At least 8 characters with a number"
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
        />
      </View>
      <Button label="Continue" size="lg" loading={busy} onPress={submit} />
      <View style={styles.footer}>
        <Text color="muted">Already have an account?</Text>
        <Link href="/sign-in">
          <Text variant="bodyStrong" color="primary">
            Sign in
          </Text>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ footer: { alignItems: 'center', gap: 4 }, form: { gap: 14 } });
