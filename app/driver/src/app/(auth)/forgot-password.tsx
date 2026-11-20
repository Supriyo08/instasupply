import { isStrongPassword, isValidEmail } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Input, Screen } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { AuthHeader } from '@/features/auth/AuthHeader';
import { requestPasswordReset, resetPassword, signIn } from '@/features/auth/auth-service';

/**
 * Two steps (CLIENTS §2.2, §2.3): the email, then the 6-digit code from it and a new password. The
 * server answers the first step the same way whether or not the account exists.
 */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState<'send' | 'reset' | null>(null);

  const sendCode = async () => {
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    setBusy('send');
    setError(null);
    try {
      await requestPasswordReset(email);
      setResent(step === 'code');
      setStep('code');
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    const strength = isStrongPassword(password);
    if (!strength.ok) return setError(strength.message ?? 'Choose a stronger password.');
    setBusy('reset');
    setError(null);
    try {
      await resetPassword({ email, code: code.trim(), newPassword: password });
      await signIn(email, password);
    } catch (cause) {
      setError(authErrorMessage(cause));
      setBusy(null);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  return (
    <Screen keyboard>
      <SceneArt scene="scene-support" height={140} />
      <AuthHeader
        title="Reset password"
        subtitle={
          step === 'email' ? "We'll email you a 6-digit code." : `Enter the code we sent to ${email.trim()}.`
        }
      />
      {step === 'code' && !error ? (
        <Banner
          tone="success"
          title={resent ? 'New code sent' : 'Check your inbox'}
          message={`If ${email.trim()} has a driver account, a code is on its way.`}
        />
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
      {step === 'email' ? (
        <View style={styles.form}>
          <Input
            label="Email"
            icon="mail-outline"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => void sendCode()}
            returnKeyType="send"
          />
          <Button label="Send code" size="lg" loading={busy === 'send'} onPress={() => void sendCode()} />
        </View>
      ) : (
        <View style={styles.form}>
          <Input
            label="Code from the email"
            icon="keypad-outline"
            placeholder="6 digits"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            value={code}
            onChangeText={(next) => setCode(next.replace(/\D/g, ''))}
          />
          <Input
            label="New password"
            icon="lock-closed-outline"
            placeholder="At least 8 characters with a number"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void reset()}
            returnKeyType="go"
          />
          <Button
            label="Set new password and sign in"
            size="lg"
            loading={busy === 'reset'}
            disabled={busy === 'send'}
            onPress={() => void reset()}
          />
          <Button
            label="Send a new code"
            variant="ghost"
            loading={busy === 'send'}
            disabled={busy === 'reset'}
            onPress={() => void sendCode()}
          />
          <Button
            label="Use a different email"
            variant="ghost"
            disabled={busy !== null}
            onPress={() => {
              setStep('email');
              setCode('');
              setError(null);
              setResent(false);
            }}
          />
        </View>
      )}
      <Button label="Back to sign in" variant="ghost" icon="arrow-back" onPress={back} />
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: 14 } });
