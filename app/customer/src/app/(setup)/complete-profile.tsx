import { describeError } from '@instasupply/api-client';
import { cleanText } from '@instasupply/shared';
import { useEffect, useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { clearSignUpFailure, completeProfile, getSignUpFailure } from '@/features/session/auth-service';
import { FormInput } from '@/features/session/components/FormInput';
import { SetupSteps } from '@/features/session/components/SetupSteps';
import { SignOutLink } from '@/features/session/components/SignOutLink';
import { StepHeading } from '@/features/session/components/StepHeading';
import { StepScreen } from '@/features/session/components/StepScreen';
import { validateName } from '@/features/session/components/validation';
import { useSession } from '@/features/session/SessionProvider';

/**
 * Reached when an account has no shopping profile yet because sign-up was interrupted; the user
 * finishes it here. (While sign-up is still running the session stays "loading" instead.)
 */
export default function CompleteProfileScreen() {
  const { user } = useSession();
  // If sign-up just failed at the profile step, start from the name typed there and say why.
  const [failure] = useState(() => getSignUpFailure(user?.uid));
  const [name, setName] = useState(failure?.name ?? user?.displayName ?? '');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string | null>(failure?.message ?? null);
  const [busy, setBusy] = useState(false);

  // The sign-up error (if any) is now shown here; don't repeat it for another account later.
  useEffect(() => {
    clearSignUpFailure();
  }, []);

  const submit = async () => {
    if (busy) return;
    const invalid = validateName(name);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await completeProfile({ displayName: cleanText(name, 80) ?? name });
      // The router continues to phone verification once the profile exists.
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <StepScreen title="Your profile" back={false}>
      <SetupSteps current={1} />
      <StepHeading
        icon="user"
        title="What should we call you?"
        subtitle="Your name appears on your orders and helps our delivery partners find you at the door."
      />
      {error ? (
        <Notice tone="danger" title="We couldn't finish setting up your account" message={error} />
      ) : null}
      <FormInput
        icon="user"
        placeholder="Full name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setFieldError(undefined);
        }}
        error={fieldError}
        editable={!busy}
        autoCapitalize="words"
        autoComplete="name"
        autoFocus={!name}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Button label="Continue" loading={busy} onPress={() => void submit()} />
      <SignOutLink email={user?.email} />
    </StepScreen>
  );
}
