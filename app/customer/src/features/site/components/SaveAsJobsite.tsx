import { validateJobsite, type Jobsite, type UserProfile } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Input, Notice, Text } from '@/components/ui';
import { describeError } from '@/lib/api';
import { spacing } from '@/theme/tokens';

import { saveJobsite } from '../hooks';
import type { PlaceDetails } from '../place';

/**
 * 🔒 "Save as jobsite" for a searched address, GPS fix or dropped pin: a name, the street address or
 * lot ("Lot 14, Phase 3") and the site contact. Receiving and vehicle limits are edited later on the
 * jobsite screen.
 */
export function SaveAsJobsite({
  place,
  profile,
  makeDefault,
  onSaved,
}: {
  place: PlaceDetails;
  profile: UserProfile;
  makeDefault: boolean;
  onSaved: (jobsite: Jobsite) => void;
}) {
  const [label, setLabel] = useState('');
  const [line1, setLine1] = useState(place.line1 ?? '');
  const [contactName, setContactName] = useState(profile.displayName);
  const [contactPhone, setContactPhone] = useState(profile.phoneNumber ?? '');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const checked = validateJobsite({
      label,
      line1,
      line2: null,
      city: place.city,
      province: 'ON',
      postalCode: place.postalCode,
      location: place.location,
      cityId: place.cityId,
      areaLabel: place.areaLabel,
      contactName,
      contactPhone,
      instructions: null,
      receiving: 'attended',
      maxVehicleClass: null,
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      const other = Object.entries(checked.errors).find(
        ([key]) => !['label', 'line1', 'contactName', 'contactPhone'].includes(key),
      );
      setFormError(other?.[1] ?? null);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const saved = await saveJobsite({ ...checked.value, isDefault: makeDefault });
      onSaved(saved);
    } catch (caught) {
      setFormError(describeError(caught));
      setBusy(false);
    }
  };

  const clear = (key: string) => setErrors((current) => ({ ...current, [key]: undefined }));

  return (
    <Card style={styles.card}>
      <Text variant="heading">Save as jobsite</Text>
      <Text variant="caption" color="muted">
        Saved jobsites keep the site contact for drivers and show up at checkout.
      </Text>
      <View style={styles.fields}>
        <Input
          tone="muted"
          label="Jobsite name"
          placeholder="Leslieville semi reno"
          value={label}
          maxLength={40}
          onChangeText={(value) => {
            setLabel(value);
            clear('label');
          }}
          error={errors.label}
        />
        <Input
          tone="muted"
          label="Street address or lot"
          placeholder="123 Main St, or Lot 14, Phase 3"
          value={line1}
          maxLength={160}
          onChangeText={(value) => {
            setLine1(value);
            clear('line1');
          }}
          error={errors.line1}
          hint={`${place.areaLabel}${place.postalCode ? ` · ${place.postalCode}` : ''}`}
        />
        <Input
          tone="muted"
          label="Site contact"
          value={contactName}
          maxLength={80}
          onChangeText={(value) => {
            setContactName(value);
            clear('contactName');
          }}
          error={errors.contactName}
          autoComplete="name"
        />
        <Input
          tone="muted"
          label="Site contact phone"
          placeholder="(416) 555-0110"
          value={contactPhone}
          keyboardType="phone-pad"
          maxLength={18}
          onChangeText={(value) => {
            setContactPhone(value);
            clear('contactPhone');
          }}
          error={errors.contactPhone}
          autoComplete="tel"
        />
      </View>
      {formError ? <Notice tone="danger" message={formError} /> : null}
      <Button label="Save jobsite" loading={busy} onPress={() => void save()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  fields: { gap: spacing.md },
});
