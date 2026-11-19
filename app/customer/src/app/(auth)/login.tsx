import { describeError } from '@instasupply/expo-firebase';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';

import { Button, Notice, Text } from '@/components/ui';
import { signIn } from '@/features/session/auth-service';
import {
  getDraftEmail,
  loadRememberedEmail,
  saveRememberedEmail,
  setDraftEmail,
} from '@/features/session/components/auth-drafts';
import { AuthScaffold } from '@/features/session/components/AuthScaffold';
import { AuthSwitch } from '@/features/session/components/AuthSwitch';
import { FormInput } from '@/features/session/components/FormInput';
import { RememberMeRow } from '@/features/session/components/RememberMeRow';
import { validateEmail, type FieldErrors } from '@/features/session/components/validation';
import { spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState(getDraftEmail);
  const [password, setPassword] = useState('');
  // Firebase keeps the session either way; "Remember me" keeps the email for next time.
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<FieldErrors<'email' | 'password'>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    let active = true;
    void loadRememberedEmail().then((saved) => {
      if (!active || !saved || getDraftEmail()) return;
      setEmail(saved);
      setDraftEmail(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  const edit = (field: 'email' | 'password', value: string) => {
    if (field === 'email') {
      setEmail(value);
      setDraftEmail(value);
    } else {
      setPassword(value);
    }
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  };

  const submit = async () => {
    if (busy) return;
    const next = { email: validateEmail(email), password: password ? undefined : 'Enter your password.' };
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    setFormError(null);
    try {
      await signIn(email, password);
      void saveRememberedEmail(remember ? email.trim().toLowerCase() : null);
      // Nothing else to do: the router moves on once the session updates.
    } catch (error) {
      setFormError(describeError(error));
      setBusy(false);
    }
  };

  return (
    <AuthScaffold
      art="scene-jobsite-delivery"
      heroRatio={0.36}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
    >
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Welcome back!
        </Text>
        <Text color="muted">Sign in to your account</Text>
      </View>
      {formError ? <Notice tone="danger" message={formError} /> : null}
      <View style={styles.fields}>
        <FormInput
          icon="mail"
          placeholder="Email address"
          value={email}
          onChangeText={(value) => edit('email', value)}
          error={errors.email}
          editable={!busy}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <FormInput
          ref={passwordRef}
          icon="lock"
          placeholder="Password"
          value={password}
          onChangeText={(value) => edit('password', value)}
          error={errors.password}
          editable={!busy}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
      </View>
      <RememberMeRow
        remember={remember}
        onRememberChange={setRemember}
        onForgotPassword={() => router.push('/forgot-password')}
      />
      <Button label="Login" loading={busy} onPress={() => void submit()} />
      <AuthSwitch
        prompt="Don't have an account?"
        action="Sign up"
        onPress={() => router.replace('/signup')}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  heading: { gap: spacing.xxs },
});
