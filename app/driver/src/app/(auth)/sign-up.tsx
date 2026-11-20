import { isStrongPassword, isValidEmail } from '@instasupply/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { createAccount } from '@/features/auth/auth-service';
import { StepHeader } from '@/features/auth/StepHeader';
import { ONBOARDING_STEPS } from '@/features/vehicle/onboarding-steps';

type Field = 'name' | 'email' | 'password';

/**
 * Onboarding step 1, the account (MARKETPLACE §10, CLIENTS §2.3 `createAccount`). The account has no
 * role yet: the session moves to `needs_profile` and the profile, vehicle and attest steps follow.
 */
export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: Partial<Record<Field, string>> = {};
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (!isValidEmail(email)) next.email = 'Enter a valid email address.';
    const strength = isStrongPassword(password);
    if (!strength.ok) next.password = strength.message ?? 'Choose a stronger password.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFormError(null);
    try {
      await createAccount(name, email, password);
      // The session is now needs_profile: the layout opens onboarding/profile.
    } catch (cause) {
      setFormError(authErrorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <StepHeader
        step={ONBOARDING_STEPS.account}
        total={ONBOARDING_STEPS.total}
        title="Drive with InstaSupply"
        subtitle="Deliver lumber, drywall and fixtures from local yards to job sites. Set-up takes about five minutes."
      />
      <SceneArt scene="scene-local-suppliers" height={150} />
      {formError ? <Banner tone="danger" message={formError} /> : null}
      <View style={styles.form}>
        <Input
          label="Full name"
          icon="person-outline"
          placeholder="Alex Tremblay"
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          value={name}
          onChangeText={setName}
          error={errors.name}
        />
        <Input
          label="Email"
          icon="mail-outline"
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
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
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          returnKeyType="go"
          error={errors.password}
        />
      </View>
      <Button label="Create account" size="lg" loading={busy} onPress={() => void submit()} />
      <Text variant="caption" color="subtle" align="center">
        Next: your city, your vehicle and three quick attestations. Ops call to confirm before your first job.
      </Text>
      <View style={styles.footer}>
        <Text color="muted">Already driving with us?</Text>
        <Link href="/sign-in" accessibilityRole="link">
          <Text variant="bodyStrong" color="primary">
            Sign in
          </Text>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ footer: { alignItems: 'center', gap: 4 }, form: { gap: 14 } });
