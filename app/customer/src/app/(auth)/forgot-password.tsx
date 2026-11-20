import { describeError } from '@instasupply/api-client';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { requestPasswordReset, resetPassword } from '@/features/session/auth-service';
import { getDraftEmail, setDraftEmail } from '@/features/session/components/auth-drafts';
import { FormInput } from '@/features/session/components/FormInput';
import { StepHeading } from '@/features/session/components/StepHeading';
import { StepScreen } from '@/features/session/components/StepScreen';
import { validateEmail, validateNewPassword } from '@/features/session/components/validation';

/** Two steps (docs/CLIENTS.md §2.2): email a 6-digit code, then the code and a new password. */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState(getDraftEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; code?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const backToLogin = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  const sendCode = async () => {
    if (busy) return;
    const invalid = validateEmail(email);
    setFieldErrors({ email: invalid });
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(email.trim().toLowerCase());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy || !sentTo) return;
    const errors = {
      code: /^\d{6}$/.test(code.trim()) ? undefined : 'Enter the 6-digit code from the email.',
      password: validateNewPassword(password),
    };
    setFieldErrors(errors);
    if (errors.code || errors.password) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword({ email: sentTo, code: code.trim(), newPassword: password });
      setDone(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <StepScreen title="Password Recovery" onBack={backToLogin}>
        <StepHeading icon="check" title="Password changed" subtitle="Sign in with your new password." />
        <Button label="Back to login" onPress={backToLogin} />
      </StepScreen>
    );
  }

  return (
    <StepScreen title="Password Recovery" onBack={backToLogin}>
      <StepHeading
        icon="lock"
        title="Forgot Password"
        subtitle={
          sentTo
            ? `Enter the 6-digit code we emailed to ${sentTo} and choose a new password.`
            : "Enter your account email and we'll send you a 6-digit code to choose a new password."
        }
      />
      {error ? <Notice tone="danger" message={error} /> : null}
      {sentTo ? (
        <>
          <FormInput
            icon="hash"
            placeholder="6-digit code"
            value={code}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, '').slice(0, 6));
              setFieldErrors((current) => ({ ...current, code: undefined }));
            }}
            error={fieldErrors.code}
            editable={!busy}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
          />
          <FormInput
            icon="lock"
            placeholder="New password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }}
            error={fieldErrors.password}
            hint={password ? undefined : 'At least 8 characters, with letters and a number.'}
            editable={!busy}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            returnKeyType="go"
            onSubmitEditing={() => void reset()}
          />
          <Button label="Change password" icon="check" loading={busy} onPress={() => void reset()} />
          <Button variant="ghost" label="Send a new code" disabled={busy} onPress={() => void sendCode()} />
        </>
      ) : (
        <>
          <FormInput
            icon="mail"
            placeholder="Email address"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setDraftEmail(value);
              setFieldErrors({});
              setError(null);
            }}
            error={fieldErrors.email}
            editable={!busy}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            autoFocus={!email}
            returnKeyType="send"
            onSubmitEditing={() => void sendCode()}
          />
          <Button label="Send code" icon="send" loading={busy} onPress={() => void sendCode()} />
        </>
      )}
    </StepScreen>
  );
}
