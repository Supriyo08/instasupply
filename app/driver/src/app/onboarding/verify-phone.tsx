import { formatPhone, normalizePhone } from '@instasupply/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { requestPhoneCode, signOut, verifyPhoneCode } from '@/features/auth/auth-service';
import { StepHeader } from '@/features/auth/StepHeader';
import { ONBOARDING_STEPS } from '@/features/vehicle/onboarding-steps';
import { describeError } from '@/lib/errors';

export default function VerifyPhoneStep() {
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) return setError('Enter a Canadian mobile number, e.g. (416) 555-0151.');
    setBusy(true);
    setError(null);
    try {
      const result = await requestPhoneCode(normalized);
      setSentTo(result.phoneNumber);
      setDevCode(result.devCode ?? null);
      setCooldown(result.resendInSeconds);
      setCode('');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.replace(/\D/g, '').length !== 6) return setError('Enter the 6-digit code.');
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneCode(code);
      // The session moves on automatically once the profile is updated.
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <StepHeader
        step={ONBOARDING_STEPS.verifyPhone}
        total={ONBOARDING_STEPS.total}
        title="Verify your number"
        subtitle="Customers and dispatch reach you on this number. We'll text you a 6-digit code."
      />
      {error ? <Banner tone="danger" message={error} /> : null}
      {!sentTo ? (
        <>
          <Input
            label="Mobile number"
            icon="call-outline"
            placeholder="(416) 555-0151"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
            hint="Canadian mobile number; +1 is added for you."
          />
          <Button label="Send code" size="lg" loading={busy} onPress={send} />
        </>
      ) : (
        <>
          <Text color="muted">
            Code sent to <Text variant="bodyStrong">{formatPhone(sentTo)}</Text>
          </Text>
          {devCode ? (
            <Banner tone="info" title="Development mode" message={`Your code is ${devCode}`} />
          ) : null}
          <Input
            label="Verification code"
            icon="keypad-outline"
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={verify}
          />
          <Button label="Verify" size="lg" loading={busy} onPress={verify} />
          <View style={styles.row}>
            <Button label="Change number" variant="ghost" fullWidth={false} onPress={() => setSentTo(null)} />
            <Button
              label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              variant="ghost"
              fullWidth={false}
              disabled={cooldown > 0 || busy}
              onPress={send}
            />
          </View>
        </>
      )}
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between' } });
