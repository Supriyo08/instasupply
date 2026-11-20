import { describeError } from '@instasupply/api-client';
import { cleanText, isValidEmail, SUGGEST_STORE_INTERESTS } from '@instasupply/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, EmptyState, Header, Input, Notice, Screen, Text } from '@/components/ui';
import { useSession } from '@/features/session/SessionProvider';
import { call } from '@/lib/callables';
import { spacing } from '@/theme/tokens';

type Errors = Partial<Record<'storeName' | 'city' | 'email' | 'form', string>>;

/** Suggest a store (MARKETPLACE §7.3): works signed out too (`suggestStore`, public, rate-limited). */
export default function SuggestStoreScreen() {
  const { profile } = useSession();
  const [storeName, setStoreName] = useState('');
  const [city, setCity] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [email, setEmail] = useState(profile?.email ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const toggle = (interest: string) =>
    setInterests((current) =>
      current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest],
    );

  const submit = async () => {
    const name = cleanText(storeName, 120);
    const place = cleanText(city, 80);
    const mail = email.trim();
    const next: Errors = {};
    if (!name || name.length < 2) next.storeName = 'Enter the store name.';
    if (!place || place.length < 2) next.city = 'Enter the city or neighbourhood.';
    if (mail && !isValidEmail(mail)) next.email = 'Enter a valid email, or leave it empty.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !name || !place) return;
    setBusy(true);
    try {
      await call('suggestStore', { storeName: name, city: place, interests, email: mail || null });
      setSent(true);
    } catch (error) {
      // Keep what was typed; a lost connection or the hourly limit can be tried again.
      setErrors({ form: describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen header={<Header title="Suggest a store" />}>
        <EmptyState
          art="scene-local-suppliers"
          title="Thanks, got it!"
          message="We'll reach out to them and let you know when they're live."
          action={<Button label="Back to shopping" onPress={() => router.navigate('/')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title="Suggest a store" />}
      footer={<Button label="Send suggestion" loading={busy} onPress={() => void submit()} />}
    >
      <View style={styles.intro}>
        <Text variant="title">Don't see your supplier?</Text>
        <Text color="muted">Tell us where you buy today and we'll invite them to InstaSupply.</Text>
      </View>
      <Input
        label="Store name"
        icon="home"
        placeholder="e.g. Kestrel Lumber Yard"
        value={storeName}
        onChangeText={setStoreName}
        error={errors.storeName}
        autoCapitalize="words"
        maxLength={120}
      />
      <Input
        label="City or neighbourhood"
        icon="map-pin"
        placeholder="e.g. Etobicoke"
        value={city}
        onChangeText={setCity}
        error={errors.city}
        autoCapitalize="words"
        maxLength={80}
      />
      <View style={styles.group}>
        <Text variant="captionMedium" color="muted">
          What do you buy most?
        </Text>
        <View style={styles.chips}>
          {SUGGEST_STORE_INTERESTS.map((interest) => (
            <Chip
              key={interest}
              label={interest}
              selected={interests.includes(interest)}
              onPress={() => toggle(interest)}
            />
          ))}
        </View>
      </View>
      <Input
        label="Your email (optional)"
        icon="mail"
        placeholder="So we can tell you when they join"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      {errors.form ? (
        <Notice tone="danger" message={errors.form} actionLabel="Try again" onAction={() => void submit()} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  group: { gap: spacing.sm },
  intro: { gap: spacing.xs },
});
