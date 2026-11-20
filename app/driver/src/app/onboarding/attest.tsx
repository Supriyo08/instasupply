import { CITIES, VEHICLE_TYPE_LABELS } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Card, CheckRow, Row, Screen, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { completeProfile, signOut } from '@/features/auth/auth-service';
import { resetOnboardingDraft, useOnboardingDraft } from '@/features/auth/onboarding-draft';
import { StepHeader } from '@/features/auth/StepHeader';
import { ONBOARDING_STEPS } from '@/features/vehicle/onboarding-steps';
import { checkVehicle, vehicleFormFrom, vehicleTitle } from '@/features/vehicle/vehicle-form';
import { api, describeError } from '@/lib/api';

type Attestation = 'licence' | 'insurance' | 'terms';

const ATTESTATIONS: { id: Attestation; label: string; detail: string }[] = [
  {
    id: 'licence',
    label: 'I have a valid driver’s licence',
    detail: 'For the vehicle I drive, in Ontario.',
  },
  {
    id: 'insurance',
    label: 'My vehicle has valid insurance',
    detail: 'Commercial use included, for carrying materials for others.',
  },
  {
    id: 'terms',
    label: 'I’m responsible for the load from pickup until the delivery photo',
    detail: 'Strapped, covered and unloaded safely at the site.',
  },
];

/**
 * Onboarding, the attestations (MARKETPLACE §10). The one step that sends anything: `registerDriver`
 * with the name, city and vehicle of the draft. No document images are stored (PIPEDA). On success the
 * session moves on by itself (verify-phone or pending).
 */
export default function OnboardingAttestScreen() {
  const draft = useOnboardingDraft();
  const [ticked, setTicked] = useState<Record<Attestation, boolean>>({
    licence: false,
    insurance: false,
    terms: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const vehicle = checkVehicle(vehicleFormFrom(draft.vehicle), api.serverNow());
  const displayName = draft.displayName.trim();
  const cityId = draft.cityId;
  const allTicked = ticked.licence && ticked.insurance && ticked.terms;

  const submit = async () => {
    if (!displayName || !cityId) {
      setError('Your name and city are missing. Go back to the profile step.');
      return;
    }
    if (!vehicle.ok) {
      setError('Some vehicle details are missing. Go back to the vehicle step.');
      return;
    }
    if (!allTicked) {
      setError('Tick all three to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeProfile({
        displayName,
        cityId,
        vehicle: vehicle.value,
        attestations: { licence: true, insurance: true, terms: true },
      });
      resetOnboardingDraft();
      // The session is now needs_phone or pending_approval; the layout guard opens that step.
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    setLeaving(true);
    await signOut();
  };

  return (
    <Screen
      keyboard
      footer={
        <>
          <Button
            label="Submit for review"
            size="lg"
            icon="shield-checkmark-outline"
            loading={busy}
            disabled={!allTicked}
            onPress={() => void submit()}
            accessibilityHint="Sends your profile, vehicle and attestations to InstaSupply"
          />
          <Button
            label="Back"
            variant="ghost"
            icon="arrow-back"
            disabled={busy}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/onboarding/vehicle'))}
          />
        </>
      }
    >
      <StepHeader
        step={ONBOARDING_STEPS.attest}
        total={ONBOARDING_STEPS.total}
        title="Before you drive"
        subtitle="Confirm these three. Ops verify your licence and insurance by phone before your first job."
      />
      <SceneArt scene="scene-jobsite-delivery" height={150} />
      {error ? <Banner tone="danger" message={error} /> : null}

      <Card accessibilityLabel="What you entered">
        <Row
          icon="person-outline"
          label="Name and city"
          value={
            displayName && cityId ? `${displayName} · ${CITIES[cityId].name}` : 'Missing: go back two steps'
          }
        />
        <Row
          icon="car-outline"
          label="Vehicle"
          value={
            vehicle.ok
              ? `${VEHICLE_TYPE_LABELS[vehicle.value.type]} · ${vehicleTitle(vehicle.value)} · ${vehicle.value.plate}`
              : 'Missing: go back one step'
          }
        />
      </Card>

      <View style={styles.checks} accessibilityRole="list">
        {ATTESTATIONS.map((item) => (
          <CheckRow
            key={item.id}
            label={item.label}
            detail={item.detail}
            checked={ticked[item.id]}
            disabled={busy}
            onToggle={() => setTicked((current) => ({ ...current, [item.id]: !current[item.id] }))}
          />
        ))}
      </View>
      <Text variant="caption" color="subtle">
        We never ask for photos of your licence or insurance, and none are stored. Ops call you to confirm
        them and to set up your payouts.
      </Text>
      <Button
        label="Use a different account"
        variant="ghost"
        loading={leaving}
        disabled={busy}
        onPress={() => void switchAccount()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ checks: { gap: 4 } });
