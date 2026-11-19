import { StyleSheet, View } from 'react-native';

import { Input } from '@/components/ui';

import type { AddressDraft, AddressErrors } from './address-form';

/** Address text fields from the design: name, phone, two address lines, landmark, city + zip. */
export function AddressInputs({
  draft,
  errors,
  onChange,
}: {
  draft: AddressDraft;
  errors: AddressErrors;
  onChange: (patch: Partial<AddressDraft>) => void;
}) {
  return (
    <View style={styles.fields}>
      <Input
        icon="user"
        placeholder="Name"
        value={draft.name}
        error={errors.name}
        maxLength={80}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        onChangeText={(name) => onChange({ name })}
      />
      <Input
        icon="phone"
        placeholder="Phone number"
        value={draft.phone}
        error={errors.phone}
        maxLength={20}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        onChangeText={(phone) => onChange({ phone })}
      />
      <Input
        icon="home"
        placeholder="House no., building, street"
        value={draft.line1}
        error={errors.line1}
        maxLength={160}
        autoComplete="address-line1"
        textContentType="streetAddressLine1"
        onChangeText={(line1) => onChange({ line1 })}
      />
      <Input
        icon="layers"
        placeholder="Area, floor, apartment (optional)"
        value={draft.line2}
        error={errors.line2}
        maxLength={160}
        autoComplete="address-line2"
        textContentType="streetAddressLine2"
        onChangeText={(line2) => onChange({ line2 })}
      />
      <Input
        icon="flag"
        placeholder="Landmark (optional)"
        value={draft.landmark}
        error={errors.landmark}
        maxLength={100}
        onChangeText={(landmark) => onChange({ landmark })}
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <Input
            icon="map"
            placeholder="City"
            value={draft.city}
            error={errors.city}
            style={styles.shrink}
            maxLength={60}
            autoCapitalize="words"
            autoComplete="postal-address-locality"
            textContentType="addressCity"
            onChangeText={(city) => onChange({ city })}
          />
        </View>
        <View style={styles.half}>
          <Input
            icon="hash"
            placeholder="Zip code"
            value={draft.zip}
            error={errors.zip}
            style={styles.shrink}
            maxLength={10}
            keyboardType="number-pad"
            autoComplete="postal-code"
            textContentType="postalCode"
            onChangeText={(zip) => onChange({ zip })}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 10 },
  half: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  // On the web an <input> keeps its intrinsic width in a flex row; let half-width fields shrink.
  shrink: { minWidth: 0 },
});
