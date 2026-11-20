import { CITIES, CITY_IDS, type CityId } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Chip, Input, Screen, Text } from '@/components/ui';
import { SceneArt } from '@/features/art/SceneArt';
import { rememberedSignUpName, signOut } from '@/features/auth/auth-service';
import { updateOnboardingDraft, useOnboardingDraft } from '@/features/auth/onboarding-draft';
import { checkProfileStep, cleanDisplayName, DISPLAY_NAME_MAX } from '@/features/auth/profile-step';
import { StepHeader } from '@/features/auth/StepHeader';
import { ONBOARDING_STEPS } from '@/features/vehicle/onboarding-steps';

/**
 * Onboarding, name and city (MARKETPLACE §10). Still `needs_profile`: nothing is sent here, the name and
 * city join the draft and go to `registerDriver` with the vehicle and attestations on the attest step.
 */
export default function OnboardingProfileScreen() {
  const draft = useOnboardingDraft();
  const [name, setName] = useState(() => draft.displayName || rememberedSignUpName() || '');
  const [cityId, setCityId] = useState<CityId | null>(draft.cityId);
  const [errors, setErrors] = useState<{ name?: string; city?: string }>({});
  const [leaving, setLeaving] = useState(false);

  const changeName = (value: string) => {
    setName(value);
    if (errors.name) setErrors((current) => ({ ...current, name: checkProfileStep(value, cityId).name }));
  };

  const pickCity = (value: CityId) => {
    setCityId(value);
    setErrors((current) => ({ ...current, city: undefined }));
  };

  const next = () => {
    const found = checkProfileStep(name, cityId);
    setErrors(found);
    if (found.name || found.city || !cityId) return;
    updateOnboardingDraft({ displayName: cleanDisplayName(name), cityId });
    router.push('/onboarding/vehicle');
  };

  const switchAccount = async () => {
    setLeaving(true);
    await signOut();
  };

  return (
    <Screen
      keyboard
      footer={
        <Button
          label="Continue"
          size="lg"
          onPress={next}
          accessibilityHint="Saves your name and city and opens the vehicle step"
        />
      }
    >
      <StepHeader
        step={ONBOARDING_STEPS.profile}
        total={ONBOARDING_STEPS.total}
        title="About you"
        subtitle="Stores and site contacts see your name. Jobs are offered in the city you pick."
      />
      <SceneArt scene="scene-jobsite-delivery" height={150} />
      {errors.name || errors.city ? <Banner tone="danger" message="Check the fields marked below." /> : null}
      <Input
        label="Full name"
        icon="person-outline"
        placeholder="e.g. Lena Kowalski"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={DISPLAY_NAME_MAX + 20}
        value={name}
        onChangeText={changeName}
        error={errors.name ?? null}
      />
      <View style={styles.cities}>
        <Text variant="caption" color="muted">
          City you drive in
        </Text>
        <View style={styles.chips}>
          {CITY_IDS.map((id) => (
            <Chip key={id} label={CITIES[id].name} selected={cityId === id} onPress={() => pickCity(id)} />
          ))}
        </View>
        {errors.city ? (
          <Text variant="caption" color="danger">
            {errors.city}
          </Text>
        ) : (
          <Text variant="caption" color="subtle">
            After approval, only InstaSupply support can change your city.
          </Text>
        )}
      </View>
      <Button
        label="Use a different account"
        variant="ghost"
        loading={leaving}
        onPress={() => void switchAccount()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cities: { gap: 8 },
});
