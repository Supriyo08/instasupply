import { router, useLocalSearchParams } from 'expo-router';

import { Button, Notice, Text } from '@/components/ui';
import { AuthSwitch } from '@/features/session/components/AuthSwitch';
import { CODE_LENGTH, OtpInput } from '@/features/session/components/OtpInput';
import { formatPhone } from '@/features/session/components/phone';
import { ResendCode } from '@/features/session/components/ResendCode';
import { SetupSteps } from '@/features/session/components/SetupSteps';
import { StepHeading } from '@/features/session/components/StepHeading';
import { StepScreen } from '@/features/session/components/StepScreen';
import { usePhoneCode } from '@/features/session/components/usePhoneCode';

const param = (value: string | string[] | undefined) => (typeof value === 'string' && value ? value : null);

export default function VerifyCodeScreen() {
  const params = useLocalSearchParams<{ phone?: string; devCode?: string }>();
  const phone = param(params.phone);
  const otp = usePhoneCode(phone, param(params.devCode));
  const changeNumber = () => (router.canGoBack() ? router.back() : router.replace('/verify-phone'));

  return (
    <StepScreen title="Verify Number" onBack={changeNumber}>
      <SetupSteps current={2} />
      <StepHeading
        icon="message-square"
        title="Verify your number"
        subtitle={
          phone ? (
            <>
              Enter the {CODE_LENGTH}-digit code we sent to{' '}
              {/* Non-breaking spaces keep the number on one line. */}
              <Text variant="bodyMedium">{formatPhone(phone).replace(/ /g, ' ')}</Text>
            </>
          ) : (
            'Enter your OTP code below'
          )
        }
      />
      {otp.devCode && !otp.verified ? (
        <Notice
          tone="info"
          title="Development mode"
          message={`The emulator doesn't send texts. Your code is ${otp.devCode}.`}
          actionLabel="Fill it in"
          onAction={() => otp.changeCode(otp.devCode ?? '')}
        />
      ) : null}
      <OtpInput value={otp.code} onChange={otp.changeCode} invalid={!!otp.error} disabled={otp.verified} />
      {otp.error ? <Notice tone="danger" message={otp.error} /> : null}
      {otp.notice && !otp.error ? <Notice tone="success" message={otp.notice} /> : null}
      {otp.verified ? (
        <Notice tone="success" title="Number verified" message="Taking you to the store…" />
      ) : null}
      <Button
        label="Next"
        loading={otp.verifying || otp.verified}
        disabled={otp.code.length < CODE_LENGTH}
        onPress={otp.verify}
      />
      {otp.verified ? null : phone ? (
        <>
          <ResendCode remaining={otp.resendIn} sending={otp.sending} onResend={otp.resend} />
          <AuthSwitch prompt="Wrong number?" action="Change it" onPress={changeNumber} />
        </>
      ) : (
        <AuthSwitch prompt="No code yet?" action="Enter your number" onPress={changeNumber} />
      )}
    </StepScreen>
  );
}
