import { describeError } from '@instasupply/expo-firebase';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';

import { Button, Notice, Text } from '@/components/ui';
import { createAccount } from '@/features/session/auth-service';
import { getDraftEmail, setDraftEmail } from '@/features/session/components/auth-drafts';
import { AuthScaffold } from '@/features/session/components/AuthScaffold';
import { AuthSwitch } from '@/features/session/components/AuthSwitch';
import { FormInput } from '@/features/session/components/FormInput';
import { PasswordStrength } from '@/features/session/components/PasswordStrength';
import { validateSignUp, type FieldErrors, type SignUpForm } from '@/features/session/components/validation';
import { spacing } from '@/theme/tokens';

export default function SignUpScreen() {
  const [form, setForm] = useState<SignUpForm>(() => ({
    name: '',
    email: getDraftEmail(),
    phone: '',
    password: '',
  }));
  const [errors, setErrors] = useState<FieldErrors<keyof SignUpForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInputInstance>(null);
  const phoneRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const edit = (field: keyof SignUpForm) => (value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === 'email') setDraftEmail(value);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  };

  const submit = async () => {
    if (busy) return;
    const result = validateSignUp(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      // The session shows "Setting up your account" while the profile is being created.
      await createAccount(result.value);
      // The router continues to phone verification once the profile exists.
    } catch (error) {
      // If the account was created but its profile was not, /complete-profile shows this too.
      setFormError(describeError(error));
      setBusy(false);
    }
  };

  const field = { editable: !busy, submitBehavior: 'submit' as const, returnKeyType: 'next' as const };

  return (
    <AuthScaffold
      art="scene-material-list"
      heroRatio={0.27}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
    >
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Create account
        </Text>
        <Text color="muted">Create your account and start ordering for your jobsite</Text>
      </View>
      {formError ? <Notice tone="danger" message={formError} /> : null}
      <View style={styles.fields}>
        <FormInput
          {...field}
          icon="user"
          placeholder="Full name"
          value={form.name}
          onChangeText={edit('name')}
          error={errors.name}
          autoCapitalize="words"
          autoComplete="name"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <FormInput
          {...field}
          ref={emailRef}
          icon="mail"
          placeholder="Email address"
          value={form.email}
          onChangeText={edit('email')}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />
        <FormInput
          {...field}
          ref={phoneRef}
          icon="phone"
          placeholder="Phone number (optional)"
          value={form.phone}
          onChangeText={edit('phone')}
          error={errors.phone}
          hint="We will verify it with a code in the next step."
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={18}
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <FormInput
          ref={passwordRef}
          editable={!busy}
          icon="lock"
          placeholder="Password"
          value={form.password}
          onChangeText={edit('password')}
          error={errors.password}
          hint={form.password ? undefined : 'At least 8 characters, with letters and a number.'}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <PasswordStrength password={form.password} />
      </View>
      <Button label="Sign up" loading={busy} onPress={() => void submit()} />
      <AuthSwitch prompt="Already have an account?" action="Login" onPress={() => router.replace('/login')} />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  heading: { gap: spacing.xxs },
});
