import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, Screen } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { signOut } from '@/features/auth/auth-service';
import { updateOnboardingDraft, useOnboardingDraft } from '@/features/auth/onboarding-draft';
import { StepHeader } from '@/features/auth/StepHeader';
import { ONBOARDING_STEPS } from '@/features/vehicle/onboarding-steps';
import {
  checkVehicle,
  draftVehicleOf,
  vehicleFormFrom,
  type VehicleFormErrors,
} from '@/features/vehicle/vehicle-form';
import { VehicleFields } from '@/features/vehicle/VehicleFields';
import { api } from '@/lib/api';

/**
 * Onboarding, the vehicle (MARKETPLACE §10). Still `needs_profile`: nothing is sent here, the vehicle
 * joins the draft and goes to `registerDriver` with the attestations on the next step.
 */
export default function OnboardingVehicleScreen() {
  const draft = useOnboardingDraft();
  const [value, setValue] = useState(() => vehicleFormFrom(draft.vehicle));
  const [errors, setErrors] = useState<VehicleFormErrors>({});
  const [leaving, setLeaving] = useState(false);
  const missingProfile = !draft.displayName.trim() || !draft.cityId;

  // Once a check has failed, every edit checks again, so a fixed field loses its message at once.
  const change = (next: typeof value) => {
    setValue(next);
    if (Object.keys(errors).length > 0) {
      const checked = checkVehicle(next, api.serverNow());
      setErrors(checked.ok ? {} : checked.errors);
    }
  };

  const next = () => {
    const checked = checkVehicle(value, api.serverNow());
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    updateOnboardingDraft({ vehicle: checked.value });
    router.push('/onboarding/attest');
  };

  const back = () => {
    // Keep what was typed so far, valid or not, when the driver steps back to the profile.
    updateOnboardingDraft({ vehicle: draftVehicleOf(value) });
    if (router.canGoBack()) router.back();
    else router.replace('/onboarding/profile');
  };

  const switchAccount = async () => {
    setLeaving(true);
    await signOut();
  };

  const errorCount = Object.keys(errors).length;

  return (
    <Screen
      keyboard
      footer={
        <>
          <Button
            label="Continue"
            size="lg"
            onPress={next}
            accessibilityHint="Checks the vehicle and opens the attestations"
          />
          <Button label="Back" variant="ghost" icon="arrow-back" onPress={back} />
        </>
      }
    >
      <StepHeader
        step={ONBOARDING_STEPS.vehicle}
        total={ONBOARDING_STEPS.total}
        title="Your vehicle"
        subtitle="Jobs are matched to what you drive: a car takes a few boxes of fasteners, a flatbed takes the lumber package."
      />
      <SceneArt scene="scene-pickup-ready" height={150} />
      {missingProfile ? (
        <Banner
          tone="warning"
          title="Your name and city are missing"
          message="Go back one step and fill them in before you finish."
        />
      ) : null}
      {errorCount > 0 ? (
        <Banner
          tone="danger"
          message={errorCount === 1 ? 'Check the field marked below.' : 'Check the fields marked below.'}
        />
      ) : null}
      <VehicleFields value={value} onChange={change} errors={errors} />
      <Button
        label="Use a different account"
        variant="ghost"
        loading={leaving}
        onPress={() => void switchAccount()}
      />
    </Screen>
  );
}
