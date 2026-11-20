import { describeError } from '@instasupply/api-client';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { rememberedSignUpPhone } from '@/features/session/auth-service';
import {
  parsePhoneInput,
  pendingCodeRequest,
  sendPhoneCode,
  toNationalInput,
  type CodeRequest,
} from '@/features/session/components/phone';
import { PhoneField } from '@/features/session/components/PhoneField';
import { SetupSteps } from '@/features/session/components/SetupSteps';
import { SignOutLink } from '@/features/session/components/SignOutLink';
import { StepHeading } from '@/features/session/components/StepHeading';
import { StepScreen } from '@/features/session/components/StepScreen';
import { useSession } from '@/features/session/SessionProvider';

function openCodeScreen(request: CodeRequest) {
  router.push({
    pathname: '/verify-code',
    params: { phone: request.phone, ...(request.devCode ? { devCode: request.devCode } : {}) },
  });
}

export default function VerifyPhoneScreen() {
  const { user, profile } = useSession();
  // Pre-fill the number given at sign-up (kept in memory by the auth service).
  const [phone, setPhone] = useState(() => toNationalInput(rememberedSignUpPhone() ?? profile?.phoneNumber));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const parsed = parsePhoneInput(phone);
    if (parsed.error !== undefined) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(null);
    setError(null);
    // A code sent moments ago is still valid; asking again would only hit the resend cooldown.
    const recent = pendingCodeRequest(parsed.phone);
    if (recent) {
      openCodeScreen(recent);
      return;
    }
    setBusy(true);
    try {
      openCodeScreen(await sendPhoneCode(parsed.phone));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScreen title="Verify Number" back={false}>
      <SetupSteps current={2} />
      <StepHeading
        icon="smartphone"
        title="Verify your number"
        subtitle="We'll text you a 6-digit code. Our delivery partners use this number if they need to reach you."
      />
      {error ? <Notice tone="danger" message={error} /> : null}
      <PhoneField
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          setFieldError(null);
          setError(null);
        }}
        onSubmitEditing={() => void submit()}
        error={fieldError}
        editable={!busy}
      />
      <Button label="Next" loading={busy} onPress={() => void submit()} />
      <SignOutLink email={user?.email} />
    </StepScreen>
  );
}
