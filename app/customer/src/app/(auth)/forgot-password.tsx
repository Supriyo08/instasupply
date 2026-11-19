import { describeError } from '@instasupply/expo-firebase';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { resetPassword } from '@/features/session/auth-service';
import { getDraftEmail, setDraftEmail } from '@/features/session/components/auth-drafts';
import { FormInput } from '@/features/session/components/FormInput';
import { StepHeading } from '@/features/session/components/StepHeading';
import { StepScreen } from '@/features/session/components/StepScreen';
import { validateEmail } from '@/features/session/components/validation';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState(getDraftEmail);
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (value: string) => {
    setEmail(value);
    setDraftEmail(value);
    setFieldError(undefined);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    const invalid = validateEmail(email);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email);
      setSentTo(email.trim().toLowerCase());
    } catch (cause) {
      setSentTo(null);
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  return (
    <StepScreen title="Password Recovery" onBack={backToLogin}>
      <StepHeading
        icon="lock"
        title="Forgot Password"
        subtitle="Enter the email you shop with and we'll send you a link to choose a new password."
      />
      {sentTo ? (
        <Notice
          tone="success"
          title="Check your inbox"
          message={`If an account exists for ${sentTo}, a reset link is on its way. It can take a minute — check your spam folder too.`}
        />
      ) : null}
      {error ? <Notice tone="danger" message={error} /> : null}
      <FormInput
        icon="mail"
        placeholder="Email address"
        value={email}
        onChangeText={edit}
        error={fieldError}
        editable={!busy}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        autoFocus={!email}
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />
      <Button
        label={sentTo ? 'Send again' : 'Send link'}
        icon="send"
        loading={busy}
        onPress={() => void submit()}
      />
      {sentTo ? <Button variant="ghost" label="Back to login" onPress={backToLogin} /> : null}
    </StepScreen>
  );
}
